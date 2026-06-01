/**
 * Multilingual translation quality harness (evaluation only).
 * Pipeline: Original → Translate → Rewrite → Back-translate → Evaluate
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scoreTranslationPair } from './translation-quality-score.js';
import { buildBackTranslationPrompts } from './translation-quality-score.js';
import {
  buildLanguageAwareRewritePrompts,
  buildLanguageAwareRewriteBatchPrompts
} from './translation-rewrite-strategies.js';
import { buildLanguageConfidence } from './spoken-language-detection.js';
import { detectForeignContamination, isPersianTargetLanguage } from './subtitle-translation-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CORPUS_ROOT = join(__dirname, '..', 'test-corpus');

export const HARNESS_LANGUAGES = ['en', 'ar', 'es', 'ru', 'fr', 'de', 'tr', 'fa', 'tl', 'hi'];
export const HARNESS_DOMAINS = ['general', 'fitness', 'business', 'technology'];

const MEANING_THRESHOLD = 70;
const TRANSLATION_THRESHOLD = 75;
const CONFIDENCE_THRESHOLD = 0.8;

export function loadCorpusFile(language, domain) {
  const path = join(CORPUS_ROOT, language, `${domain}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(raw.sentences) ? raw.sentences : raw;
}

/**
 * @param {object} row
 * @returns {object[]} failure flags
 */
export function detectHarnessFailures(row) {
  const failures = [];
  const tgt = row.targetLanguage;

  if (isPersianTargetLanguage(tgt) || ['ar', 'hi', 'ru'].includes(String(tgt).slice(0, 2))) {
    const det = detectForeignContamination(row.translatedText || row.finalText || '', tgt);
    if (det.contaminated) {
      failures.push({
        type: 'foreign_script_contamination',
        hits: det.hits,
        text: String(row.finalText || row.translatedText || '').slice(0, 80)
      });
    }
  }

  if (row.languageConfidence != null && row.languageConfidence < CONFIDENCE_THRESHOLD) {
    failures.push({
      type: 'low_language_confidence',
      confidence: row.languageConfidence,
      detectedBy: row.detectedBy
    });
  }

  if (row.translationScore != null && row.translationScore < TRANSLATION_THRESHOLD) {
    failures.push({ type: 'low_translation_score', score: row.translationScore });
  }

  if (row.meaningScore != null && row.meaningScore < MEANING_THRESHOLD) {
    failures.push({ type: 'low_meaning_preservation', score: row.meaningScore });
  }

  return failures;
}

/**
 * Evaluate one sentence through the full pipeline.
 * @param {object} opts
 * @param {string} opts.sourceText
 * @param {string} opts.sourceLanguage
 * @param {string} opts.targetLanguage
 * @param {string} [opts.domain]
 * @param {Function} opts.translate async (text, src, tgt) => string
 * @param {Function} opts.rewrite async (source, translated, tgt) => string
 * @param {Function} opts.backTranslate async (translated, src) => string
 */
export async function evaluateHarnessSentence(opts) {
  const {
    sourceText,
    sourceLanguage,
    targetLanguage,
    domain = 'general',
    translate,
    rewrite,
    backTranslate
  } = opts;

  const langConf = buildLanguageConfidence(sourceLanguage, sourceText, [{ text: sourceText }]);

  let translatedText = await translate(sourceText, sourceLanguage, targetLanguage);
  let rewriteApplied = false;

  const preScores = scoreTranslationPair({
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage
  });

  if (preScores.needsRewrite && rewrite) {
    translatedText = await rewrite(sourceText, translatedText, targetLanguage);
    rewriteApplied = true;
  }

  let backTranslatedText = '';
  if (backTranslate) {
    try {
      backTranslatedText = await backTranslate(translatedText, sourceLanguage);
    } catch {
      backTranslatedText = '';
    }
  }

  const scores = scoreTranslationPair({
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    backTranslatedText
  });

  const row = {
    sourceLanguage,
    targetLanguage,
    domain,
    sourceText: String(sourceText).slice(0, 200),
    translatedText: String(translatedText).slice(0, 200),
    finalText: String(translatedText).slice(0, 200),
    backTranslatedText: String(backTranslatedText).slice(0, 200),
    translationScore: scores.translationScore,
    meaningScore: scores.meaningScore,
    fluencyScore: scores.fluencyScore,
    rewriteApplied,
    languageConfidence: langConf.confidence,
    detectedBy: langConf.detectedBy,
    languageNeedsReview: langConf.needsReview
  };

  row.failures = detectHarnessFailures(row);
  return row;
}

/**
 * Aggregate rows into dashboard report.
 * @param {object[]} rows
 */
export function buildQualityReport(rows) {
  const byTarget = {};
  const byPair = {};
  const failuresByType = {};
  let totalFailures = 0;

  for (const row of rows) {
    const tgt = row.targetLanguage;
    if (!byTarget[tgt]) {
      byTarget[tgt] = { scores: [], meaning: [], fluency: [], rewriteCount: 0, count: 0 };
    }
    byTarget[tgt].scores.push(row.translationScore);
    byTarget[tgt].meaning.push(row.meaningScore);
    byTarget[tgt].fluency.push(row.fluencyScore);
    byTarget[tgt].count += 1;
    if (row.rewriteApplied) byTarget[tgt].rewriteCount += 1;

    const pairKey = `${row.sourceLanguage}->${row.targetLanguage}`;
    if (!byPair[pairKey]) byPair[pairKey] = { scores: [], count: 0 };
    byPair[pairKey].scores.push(row.translationScore);
    byPair[pairKey].count += 1;

    for (const f of row.failures || []) {
      failuresByType[f.type] = (failuresByType[f.type] || 0) + 1;
      totalFailures += 1;
    }
  }

  const targets = {};
  for (const [lang, agg] of Object.entries(byTarget)) {
    const n = agg.count || 1;
    targets[lang] = {
      averageScore: Math.round(agg.scores.reduce((a, b) => a + b, 0) / n),
      averageMeaningScore: Math.round(agg.meaning.reduce((a, b) => a + b, 0) / n),
      averageFluencyScore: Math.round(agg.fluency.reduce((a, b) => a + b, 0) / n),
      rewriteRate: Number((agg.rewriteCount / n).toFixed(3)),
      sampleCount: n
    };
  }

  const pairs = {};
  for (const [key, agg] of Object.entries(byPair)) {
    const n = agg.count || 1;
    pairs[key] = {
      averageScore: Math.round(agg.scores.reduce((a, b) => a + b, 0) / n),
      sampleCount: n
    };
  }

  const ranked = Object.entries(targets)
    .map(([lang, v]) => ({ language: lang, averageScore: v.averageScore }))
    .sort((a, b) => a.averageScore - b.averageScore);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalEvaluations: rows.length,
      totalFailures,
      failuresByType,
      lowestScoringTargets: ranked.slice(0, 5),
      highestScoringTargets: [...ranked].reverse().slice(0, 5)
    },
    byTargetLanguage: targets,
    byLanguagePair: pairs,
    recommendedImprovements: buildRecommendations(targets, failuresByType, ranked),
    rows: rows.length <= 500 ? rows : undefined
  };
}

function buildRecommendations(targets, failuresByType, ranked) {
  const recs = [];
  const lowest = ranked[0];
  if (lowest && lowest.averageScore < 80) {
    recs.push(
      `Strengthen ${lowest.language} rewrite strategy and domain-specific glossary (avg score ${lowest.averageScore}).`
    );
  }
  if (failuresByType.foreign_script_contamination > 0) {
    recs.push('Expand post-translation script validation for Persian/Arabic/Hindi targets.');
  }
  if (failuresByType.low_meaning_preservation > 0) {
    recs.push('Increase back-translation weight in scoring or add meaning-focused rewrite pass.');
  }
  if (failuresByType.low_language_confidence > 0) {
    recs.push('Review accent-prone pairs (e.g. EN misdetected as RU) before translation routing.');
  }
  if (failuresByType.low_translation_score > 0) {
    recs.push('Lower rewrite threshold or add fitness/business few-shot examples per target language.');
  }
  const fa = targets.fa;
  if (fa && fa.averageScore < 85) {
    recs.push('Persian: prioritize conversational localization pass over literal MT (fitness praise patterns).');
  }
  if (recs.length === 0) {
    recs.push('Scores healthy across targets; run HARNESS_FULL=1 periodically to regression-test.');
  }
  return recs;
}

/**
 * Run harness for source language corpus → target languages.
 */
export async function runTranslationQualityHarness(opts = {}) {
  const {
    sourceLanguage = 'en',
    targetLanguages = ['fa', 'ar', 'es', 'ru', 'fr', 'de', 'tr', 'hi', 'tl'],
    domains = HARNESS_DOMAINS,
    samplePerCell = Number(process.env.HARNESS_SAMPLE_PER_CELL || 5),
    translate,
    rewrite,
    backTranslate,
    outputPath = join(CORPUS_ROOT, '..', 'experiments', 'translation-quality-harness', 'translation-quality-report.json')
  } = opts;

  if (typeof translate !== 'function') {
    throw new Error('runTranslationQualityHarness requires translate provider');
  }

  const rows = [];
  for (const domain of domains) {
    const sentences = loadCorpusFile(sourceLanguage, domain);
    if (!sentences?.length) continue;
    const sample = sentences.slice(0, samplePerCell);

    for (const targetLanguage of targetLanguages) {
      if (targetLanguage === sourceLanguage) continue;
      for (const sentence of sample) {
        const text = typeof sentence === 'string' ? sentence : sentence.text;
        const row = await evaluateHarnessSentence({
          sourceText: text,
          sourceLanguage,
          targetLanguage,
          domain,
          translate,
          rewrite,
          backTranslate
        });
        rows.push(row);
      }
    }
  }

  const report = buildQualityReport(rows);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('[translation-quality-harness] report written:', outputPath);
  return { report, rows, outputPath };
}

export { buildLanguageAwareRewritePrompts, buildLanguageAwareRewriteBatchPrompts };
