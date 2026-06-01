/**
 * Adaptive translation: multi-attempt competition, winner selection, training data.
 * Does not modify rendering, RTL, fonts, styles, or timing.
 */

import { scoreTranslationPair } from './translation-quality-score.js';
import { buildBackTranslationPrompts } from './translation-quality-score.js';
import {
  buildLanguageAwareRewriteBatchPrompts,
  buildFluencyRewriteBatchPrompts,
  isLanguageOptimizedTarget
} from './translation-rewrite-strategies.js';
import { buildPersianFluencyPrompts } from './subtitle-translation-pipeline.js';
import { selectBestVersion, compositeSelectionScore } from './translation-version-selector.js';
import {
  logTranslationCompetitionAttempt,
  logTranslationCompetitionSummary
} from './translation-competition-telemetry.js';
import {
  buildTrainingRecord,
  persistTranslationTrainingData
} from './translation-training-data.js';

export const ACCEPT_THRESHOLD = 90;
export const MAX_ATTEMPTS = 3;

const ATTEMPT_STAGES = {
  1: 'direct',
  2: 'localization',
  3: 'fluency'
};

export function isAdaptiveTranslationEnabled() {
  return String(process.env.ADAPTIVE_TRANSLATION ?? '1') !== '0';
}

function norm(code) {
  return String(code || '')
    .toLowerCase()
    .slice(0, 2);
}

function scoreCue(sourceText, translatedText, sourceLanguage, targetLanguage, backText = null) {
  const s = scoreTranslationPair({
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    backTranslatedText: backText
  });
  return {
    translationScore: s.translationScore,
    meaningScore: s.meaningScore,
    fluencyScore: s.fluencyScore,
    compositeScore: Number(compositeSelectionScore(s).toFixed(2))
  };
}

function makeVersion(attemptId, stage, text, scores) {
  return {
    attemptId,
    stage,
    text: String(text || '').trim(),
    ...scores
  };
}

function needsRetry(scores) {
  return Number(scores.translationScore) < ACCEPT_THRESHOLD;
}

async function runBatchedRewrite(
  indices,
  translatedSegments,
  sourceSegments,
  texts,
  targetLanguage,
  traceId,
  runLlmBatch,
  stage,
  label,
  contentDomain = 'general'
) {
  if (!indices.length || typeof runLlmBatch !== 'function') return new Map();

  const batch = indices.map((i) => ({
    start: translatedSegments[i].start,
    end: translatedSegments[i].end,
    text: texts[i],
    _source: sourceSegments[i].text,
    _index: i
  }));

  const prompts =
    stage === 'fluency' && norm(targetLanguage) === 'fa'
      ? buildPersianFluencyPrompts(batch, contentDomain)
      : stage === 'fluency'
        ? buildFluencyRewriteBatchPrompts(targetLanguage, batch, contentDomain)
        : buildLanguageAwareRewriteBatchPrompts(targetLanguage, batch, contentDomain);

  const out = await runLlmBatch(batch, prompts, traceId, `adaptive-${label}`, {
    temperature: stage === 'fluency' ? 0.35 : 0.3
  });

  const map = new Map();
  for (let j = 0; j < out.length; j++) {
    const idx = batch[j]._index;
    if (out[j]?.text) map.set(idx, String(out[j].text).trim());
  }
  return map;
}

/**
 * Run up to 3 attempts; batch API calls for attempts 2–3 (cost-safe).
 */
export async function runAdaptiveTranslationJob(opts) {
  const {
    sourceSegments = [],
    translatedSegments = [],
    sourceLanguage,
    targetLanguage,
    traceId,
    runLlmBatch,
    runSingleCompletion,
    contentDomain = 'general'
  } = opts;

  const n = Math.min(sourceSegments.length, translatedSegments.length);
  const texts = translatedSegments.map((s, i) => String(s.text || '').trim());
  const allAttemptsByCue = [];
  let earlyAcceptCount = 0;
  let attempt2Batches = 0;
  let attempt3Batches = 0;

  for (let i = 0; i < n; i++) {
    const scores1 = scoreCue(sourceSegments[i].text, texts[i], sourceLanguage, targetLanguage);
    const v1 = makeVersion(1, ATTEMPT_STAGES[1], texts[i], scores1);
    allAttemptsByCue[i] = [v1];
    logTranslationCompetitionAttempt(traceId, {
      cueIndex: i,
      attemptId: 1,
      stage: v1.stage,
      ...scores1,
      winner: false
    });
    if (!needsRetry(scores1)) earlyAcceptCount += 1;
  }

  let needLoc = [];
  for (let i = 0; i < n; i++) {
    const last = allAttemptsByCue[i][allAttemptsByCue[i].length - 1];
    if (needsRetry(last) && allAttemptsByCue[i].length < MAX_ATTEMPTS) needLoc.push(i);
  }

  if (needLoc.length) {
    const locMap = await runBatchedRewrite(
      needLoc,
      translatedSegments,
      sourceSegments,
      texts,
      targetLanguage,
      traceId,
      runLlmBatch,
      'localization',
      'loc-batch',
      contentDomain
    );
    attempt2Batches = 1;

    for (const i of needLoc) {
      if (locMap.has(i)) texts[i] = locMap.get(i);
      const back = await maybeBackTranslate(texts[i], sourceLanguage, runSingleCompletion);
      const scores2 = scoreCue(sourceSegments[i].text, texts[i], sourceLanguage, targetLanguage, back);
      const v2 = makeVersion(2, ATTEMPT_STAGES[2], texts[i], scores2);
      allAttemptsByCue[i].push(v2);
      logTranslationCompetitionAttempt(traceId, {
        cueIndex: i,
        attemptId: 2,
        stage: v2.stage,
        ...scores2,
        winner: false
      });
    }
  }

  let needFlu = [];
  for (let i = 0; i < n; i++) {
    const last = allAttemptsByCue[i][allAttemptsByCue[i].length - 1];
    if (needsRetry(last) && allAttemptsByCue[i].length < MAX_ATTEMPTS) needFlu.push(i);
  }

  if (needFlu.length) {
    const fluMap = await runBatchedRewrite(
      needFlu,
      translatedSegments,
      sourceSegments,
      texts,
      targetLanguage,
      traceId,
      runLlmBatch,
      'fluency',
      'flu-batch',
      contentDomain
    );
    attempt3Batches = 1;

    for (const i of needFlu) {
      if (fluMap.has(i)) texts[i] = fluMap.get(i);
      const back = await maybeBackTranslate(texts[i], sourceLanguage, runSingleCompletion);
      const scores3 = scoreCue(sourceSegments[i].text, texts[i], sourceLanguage, targetLanguage, back);
      const v3 = makeVersion(3, ATTEMPT_STAGES[3], texts[i], scores3);
      allAttemptsByCue[i].push(v3);
      logTranslationCompetitionAttempt(traceId, {
        cueIndex: i,
        attemptId: 3,
        stage: v3.stage,
        ...scores3,
        winner: false
      });
    }
  }

  const winnerSegments = [];
  const trainingRecords = [];

  for (let i = 0; i < n; i++) {
    const { bestVersion } = selectBestVersion(allAttemptsByCue[i]);
    const winner = bestVersion || allAttemptsByCue[i][0];
    logTranslationCompetitionAttempt(traceId, {
      cueIndex: i,
      attemptId: winner.attemptId,
      stage: winner.stage,
      translationScore: winner.translationScore,
      meaningScore: winner.meaningScore,
      fluencyScore: winner.fluencyScore,
      compositeScore: winner.compositeScore,
      winner: true
    });

    winnerSegments.push({
      start: Number(translatedSegments[i].start),
      end: Number(translatedSegments[i].end),
      text: winner.text
    });

    trainingRecords.push(
      buildTrainingRecord({
        traceId,
        sourceLanguage,
        targetLanguage,
        domain: contentDomain,
        source: sourceSegments[i].text,
        target: winner.text,
        winnerAttemptId: winner.attemptId,
        winnerStage: winner.stage,
        translationScore: winner.translationScore,
        meaningScore: winner.meaningScore,
        fluencyScore: winner.fluencyScore,
        compositeScore: winner.compositeScore,
        attempts: allAttemptsByCue[i]
      })
    );
  }

  const persist = persistTranslationTrainingData(traceId, trainingRecords);
  const winnerScores = aggregateWinnerScores(trainingRecords);

  const summary = {
    cueCount: n,
    earlyAcceptCount,
    attempt2Batches,
    attempt3Batches,
    maxAttemptsPerCue: MAX_ATTEMPTS,
    acceptThreshold: ACCEPT_THRESHOLD,
    targetLanguage,
    contentDomain,
    languageOptimized: isLanguageOptimizedTarget(targetLanguage),
    averageWinnerTranslationScore: winnerScores.translationScore,
    averageWinnerMeaningScore: winnerScores.meaningScore,
    averageWinnerFluencyScore: winnerScores.fluencyScore,
    trainingDataSaved: persist.saved
  };

  logTranslationCompetitionSummary(traceId, summary);

  return {
    segments: winnerSegments,
    attemptsByCue: allAttemptsByCue,
    trainingRecords,
    winnerScores,
    summary,
    initialScore: averageAttemptScore(allAttemptsByCue, 1),
    rewrittenScore: winnerScores.translationScore,
    rewritten: trainingRecords.some((r) => r.winnerAttemptId > 1),
    scores: winnerScores
  };
}

async function maybeBackTranslate(text, sourceLanguage, runSingleCompletion) {
  if (!runSingleCompletion || String(process.env.TRANSLATION_QUALITY_LLM ?? '1') === '0') {
    return null;
  }
  try {
    const prompts = buildBackTranslationPrompts(text, sourceLanguage);
    const back = await runSingleCompletion(prompts);
    return back ? String(back).trim() : null;
  } catch {
    return null;
  }
}

function averageAttemptScore(allAttempts, attemptId) {
  let sum = 0;
  let c = 0;
  for (const versions of allAttempts) {
    const v = versions.find((a) => a.attemptId === attemptId);
    if (v) {
      sum += v.translationScore;
      c += 1;
    }
  }
  return c ? Math.round(sum / c) : 0;
}

function aggregateWinnerScores(records) {
  if (!records.length) {
    return { translationScore: 0, meaningScore: 0, fluencyScore: 0 };
  }
  let t = 0;
  let m = 0;
  let f = 0;
  for (const r of records) {
    t += r.scores.translationScore;
    m += r.scores.meaningScore;
    f += r.scores.fluencyScore;
  }
  const n = records.length;
  return {
    translationScore: Math.round(t / n),
    meaningScore: Math.round(m / n),
    fluencyScore: Math.round(f / n)
  };
}

export { selectBestVersion, compositeSelectionScore } from './translation-version-selector.js';
