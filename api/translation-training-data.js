/**
 * Persist adaptive translation outcomes for future training/evaluation.
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TRAINING_DATA_ROOT = join(__dirname, '..', 'translation-training-data');

/**
 * @param {object} record
 */
export function buildTrainingRecord(record) {
  return {
    recordedAt: new Date().toISOString(),
    traceId: record.traceId,
    domain: record.domain || 'general',
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    source: record.source,
    target: record.target,
    winnerAttemptId: record.winnerAttemptId,
    winnerStage: record.winnerStage || null,
    scores: {
      translationScore: record.translationScore,
      meaningScore: record.meaningScore,
      fluencyScore: record.fluencyScore,
      compositeScore: record.compositeScore
    },
    attempts: (record.attempts || []).map((a) => ({
      attemptId: a.attemptId,
      stage: a.stage,
      text: a.text,
      translationScore: a.translationScore,
      meaningScore: a.meaningScore,
      fluencyScore: a.fluencyScore
    }))
  };
}

/**
 * Append job-level training JSONL + per-job summary file.
 * @param {string} traceId
 * @param {object[]} cueRecords — from buildTrainingRecord per cue
 */
export function persistTranslationTrainingData(traceId, cueRecords) {
  if (String(process.env.TRANSLATION_TRAINING_DATA ?? '1') === '0') {
    return { saved: false, reason: 'disabled' };
  }

  const jobsDir = join(TRAINING_DATA_ROOT, 'jobs');
  mkdirSync(jobsDir, { recursive: true });

  const jsonlPath = join(TRAINING_DATA_ROOT, 'dataset.jsonl');
  const jobPath = join(jobsDir, `${traceId}.json`);

  const jobPayload = {
    traceId,
    recordedAt: new Date().toISOString(),
    domain: cueRecords[0]?.domain || 'general',
    cueCount: cueRecords.length,
    cues: cueRecords
  };

  writeFileSync(jobPath, JSON.stringify(jobPayload, null, 2), 'utf8');

  for (const row of cueRecords) {
    appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
  }

  return { saved: true, jobPath, jsonlPath, cueCount: cueRecords.length };
}
