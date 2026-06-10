/**
 * V1 vs V2 ASR comparison report — for debugging pipeline regressions.
 */

function countWords(text) {
  return String(text || '')
    .split(/\s+/)
    .filter((w) => w.trim().length > 0).length;
}

function segmentWordCount(seg) {
  return countWords(seg?.text);
}

/**
 * @param {object} v1Result — output of applyV1PostProcessing
 * @param {object} v2Result — output of finalizeV2Transcript / preserveProviderOutput
 */
export function buildV1V2ComparisonReport(v1Result, v2Result) {
  const v1Segs = Array.isArray(v1Result?.segments) ? v1Result.segments : [];
  const v2Segs = Array.isArray(v2Result?.segments) ? v2Result.segments : [];

  const v1WordCount = countWords(v1Result?.text);
  const v2WordCount = countWords(v2Result?.text);

  const missingSegmentCount = Math.max(0, v2Segs.length - v1Segs.length);

  const timingModifications = [];
  const pairCount = Math.min(v1Segs.length, v2Segs.length);
  for (let i = 0; i < pairCount; i++) {
    const raw = v2Segs[i];
    const processed = v1Segs[i];
    const startDelta = Number(processed?.start ?? 0) - Number(raw?.start ?? 0);
    const endDelta = Number(processed?.end ?? 0) - Number(raw?.end ?? 0);
    const textChanged = String(raw?.text ?? '') !== String(processed?.text ?? '');
    if (
      Math.abs(startDelta) > 0.001 ||
      Math.abs(endDelta) > 0.001 ||
      textChanged
    ) {
      timingModifications.push({
        index: i,
        v2_raw: {
          start: raw?.start ?? null,
          end: raw?.end ?? null,
          text: String(raw?.text ?? '')
        },
        v1_processed: {
          start: processed?.start ?? null,
          end: processed?.end ?? null,
          text: String(processed?.text ?? '')
        },
        startDeltaSec: Number(startDelta.toFixed(4)),
        endDeltaSec: Number(endDelta.toFixed(4)),
        textChanged
      });
    }
  }

  const v2SegmentWords = v2Segs.reduce((n, s) => n + segmentWordCount(s), 0);
  const v1SegmentWords = v1Segs.reduce((n, s) => n + segmentWordCount(s), 0);

  return {
    generatedAt: new Date().toISOString(),
    v1SegmentCount: v1Segs.length,
    v2SegmentCount: v2Segs.length,
    segmentCountDelta: v1Segs.length - v2Segs.length,
    v1WordCount,
    v2WordCount,
    wordCountDelta: v1WordCount - v2WordCount,
    v1SegmentWordCount: v1SegmentWords,
    v2SegmentWordCount: v2SegmentWords,
    missingSegmentCount,
    timingModificationCount: timingModifications.length,
    timingModifications: timingModifications.slice(0, 100),
    summary: [
      `V2 raw segments: ${v2Segs.length}, V1 processed segments: ${v1Segs.length}`,
      `V2 words: ${v2WordCount}, V1 words: ${v1WordCount}`,
      `Segments lost in V1: ${missingSegmentCount}`,
      `Timing/text modifications: ${timingModifications.length}`
    ].join(' | ')
  };
}
