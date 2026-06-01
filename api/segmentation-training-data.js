/**
 * Persist semantic segmentation outcomes for future fine-tuning / evaluation.
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SEGMENTATION_DATA_ROOT = join(
  __dirname,
  '..',
  'translation-training-data',
  'segmentation'
);

export function buildSegmentationRecord(record) {
  return {
    recordedAt: new Date().toISOString(),
    language: record.language || 'unknown',
    domain: record.domain || 'general',
    text: record.text,
    chosenLines: record.chosenLines,
    score: record.score,
    breakReason: record.breakReason || null,
    selectedVersion: record.selectedVersion || 'semantic',
    currentScore: record.currentScore,
    semanticScore: record.semanticScore
  };
}

/**
 * @param {object[]} records
 * @param {string} [traceId]
 */
export function persistSegmentationTrainingData(records, traceId = null) {
  if (String(process.env.SEGMENTATION_TRAINING_DATA ?? '1') === '0') {
    return { saved: false };
  }

  mkdirSync(SEGMENTATION_DATA_ROOT, { recursive: true });
  const jsonlPath = join(SEGMENTATION_DATA_ROOT, 'dataset.jsonl');

  for (const r of records) {
    appendFileSync(jsonlPath, `${JSON.stringify(buildSegmentationRecord(r))}\n`, 'utf8');
  }

  if (traceId) {
    const jobPath = join(SEGMENTATION_DATA_ROOT, `${traceId}.json`);
    writeFileSync(
      jobPath,
      JSON.stringify({ traceId, recordedAt: new Date().toISOString(), records }, null, 2),
      'utf8'
    );
    return { saved: true, jsonlPath, jobPath, count: records.length };
  }

  return { saved: true, jsonlPath, count: records.length };
}
