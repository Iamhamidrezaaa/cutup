/**
 * Translation quality evaluation + automatic rewrite (diagnostics-driven).
 */

import { scoreTranslationBatch, scoreTranslationPair } from './translation-quality-score.js';
import { buildLanguageAwareRewriteBatchPrompts } from './translation-rewrite-strategies.js';
import { sanitizeTranslationCueText } from './translation-output-sanitizer.js';
import {
  pickBackTranslationSampleIndices,
  backTranslateSampleIndices
} from './translation-optimization.js';

function isQualityLlmEnabled() {
  return String(process.env.TRANSLATION_QUALITY_LLM ?? '1') !== '0';
}

function isQualityRewriteEnabled() {
  return String(process.env.TRANSLATION_QUALITY_REWRITE ?? '1') !== '0';
}

/**
 * Back-translate first/middle/last sample cues (max 9) for semantic scoring.
 */
async function backTranslateSample(
  translatedSegments,
  sourceLanguage,
  runLlmBatch,
  runSingleCompletion,
  traceId,
  optimization = null
) {
  if (!isQualityLlmEnabled()) return new Map();
  const texts = translatedSegments.map((s) => String(s?.text || '').trim());
  const indices = pickBackTranslationSampleIndices(texts.length);
  if (!indices.length) return new Map();

  const avoided = Math.max(0, texts.length - indices.length);
  optimization?.recordBackTranslateAvoided(avoided);
  optimization?.recordBackTranslateSample(indices.length);

  return backTranslateSampleIndices(
    indices,
    texts,
    sourceLanguage,
    runLlmBatch,
    runSingleCompletion,
    traceId
  );
}

/**
 * @param {object} opts
 * @param {{ start, end, text }[]} opts.sourceSegments
 * @param {{ start, end, text }[]} opts.translatedSegments
 * @param {string} opts.sourceLanguage
 * @param {string} opts.targetLanguage
 * @param {string} opts.traceId
 * @param {Function} [opts.runLlmBatch] completeSubtitleTextBatch(batch, prompts, ...)
 * @param {Function} [opts.runSingleCompletion] async (prompts) => string
 */
export async function evaluateAndRewriteTranslation(opts) {
  const {
    sourceSegments = [],
    translatedSegments = [],
    sourceLanguage,
    targetLanguage,
    traceId,
    runLlmBatch,
    runSingleCompletion,
    contentDomain = 'general',
    perf = null,
    optimization = null
  } = opts;

  const runBackSample = () =>
    backTranslateSample(
      translatedSegments,
      sourceLanguage,
      runLlmBatch,
      runSingleCompletion,
      traceId,
      optimization
    );

  const backTranslations = perf
    ? await perf.timeAsync('backTranslationMs', runBackSample)
    : await runBackSample();

  const initialBatch = perf
    ? perf.timeSync('qualityScoreMs', () =>
        scoreTranslationBatch(sourceSegments, translatedSegments, {
          sourceLanguage,
          targetLanguage,
          backTranslations,
          maxSample: Math.min(12, translatedSegments.length)
        })
      )
    : scoreTranslationBatch(sourceSegments, translatedSegments, {
        sourceLanguage,
        targetLanguage,
        backTranslations,
        maxSample: Math.min(12, translatedSegments.length)
      });

  const initialScore = initialBatch.translationScore;
  let working = translatedSegments.map((s) => ({ ...s }));
  let rewritten = false;
  let rewrittenScore = initialScore;

  if (
    isQualityRewriteEnabled() &&
    initialBatch.needsRewrite &&
    typeof runLlmBatch === 'function'
  ) {
    const rewriteIndices = initialBatch.perCue
      .filter((p) => p.needsRewrite)
      .map((p) => p.index);

    const toRewrite =
      rewriteIndices.length > 0
        ? rewriteIndices.slice(0, 8)
        : [...Array(Math.min(5, working.length)).keys()];

    const batch = toRewrite.map((i) => ({
      start: working[i].start,
      end: working[i].end,
      text: working[i].text,
      _index: i,
      _source: sourceSegments[i]?.text || ''
    }));

    if (batch.length) {
      const prompts = buildLanguageAwareRewriteBatchPrompts(targetLanguage, batch, contentDomain);

      try {
        const runRewrite = () =>
          runLlmBatch(batch, prompts, traceId, 'quality-rewrite', {
            temperature: 0.32
          });
        const rewrittenSegs = perf ? await perf.timeAsync('rewriteMs', runRewrite) : await runRewrite();
        for (let j = 0; j < rewrittenSegs.length; j++) {
          const idx = batch[j]._index;
          if (working[idx] && rewrittenSegs[j]?.text) {
            working[idx] = {
              ...working[idx],
              text: sanitizeTranslationCueText(
                String(rewrittenSegs[j].text).trim(),
                sourceSegments[idx]?.text || ''
              )
            };
          }
        }
        rewritten = true;

        const afterBatch = perf
          ? perf.timeSync('qualityScoreMs', () =>
              scoreTranslationBatch(sourceSegments, working, {
                sourceLanguage,
                targetLanguage,
                backTranslations: new Map(),
                maxSample: Math.min(12, working.length)
              })
            )
          : scoreTranslationBatch(sourceSegments, working, {
              sourceLanguage,
              targetLanguage,
              backTranslations: new Map(),
              maxSample: Math.min(12, working.length)
            });
        rewrittenScore = afterBatch.translationScore;

        return {
          segments: working,
          initialScore,
          rewrittenScore,
          rewritten: true,
          scores: afterBatch,
          initialScores: initialBatch
        };
      } catch (err) {
        console.warn('[translation-quality] rewrite pass failed', {
          traceId,
          message: err?.message
        });
      }
    }
  }

  return {
    segments: working,
    initialScore,
    rewrittenScore: initialScore,
    rewritten: false,
    scores: initialBatch,
    initialScores: initialBatch
  };
}

export { scoreTranslationPair, exampleQualityScores } from './translation-quality-score.js';
