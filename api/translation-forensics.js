/**
 * Translation pipeline audit logs.
 * Enable: TRANSLATION_FORENSIC=1
 */

const MAX_SEGMENTS = Math.min(
  20,
  Math.max(3, Number(process.env.TRANSLATION_FORENSIC_MAX || 8) || 8)
);

export function isTranslationForensicEnabled() {
  const flag = String(process.env.TRANSLATION_FORENSIC || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * @param {object} payload
 */
export function logTranslationForensics(payload) {
  if (!isTranslationForensicEnabled()) return;
  console.log('[translation-forensics]', JSON.stringify(payload, null, 0));
}

/**
 * Build per-segment rows for audit (paired original → translated).
 * @param {{ start: number, end: number, text: string }[]} originalSegments
 * @param {{ start: number, end: number, text: string }[]} translatedSegments
 * @param {object} meta
 */
export function buildTranslationForensicReport(originalSegments, translatedSegments, meta = {}) {
  const n = Math.min(
    MAX_SEGMENTS,
    originalSegments?.length || 0,
    translatedSegments?.length || 0
  );
  const pairs = [];
  for (let i = 0; i < n; i++) {
    pairs.push({
      index: i,
      originalEnglish: String(originalSegments[i]?.text || ''),
      translatedPersian: String(translatedSegments[i]?.text || ''),
      start: originalSegments[i]?.start,
      end: originalSegments[i]?.end,
      timestampsPreserved:
        originalSegments[i]?.start === translatedSegments[i]?.start &&
        originalSegments[i]?.end === translatedSegments[i]?.end
    });
  }
  return {
    ...meta,
    segmentPairs: pairs,
    postProcessingSteps: [
      'sanitizeTranslatedRaw',
      'sanitizeSegmentText',
      'parseTranslatedBlocksStrict | parseTranslatedBlocksLenient',
      'recoverBatchSegments (on segment-count mismatch)',
      'validateTranslationVsOriginal',
      'generateSRT (timestamps copied from original segments)'
    ]
  };
}
