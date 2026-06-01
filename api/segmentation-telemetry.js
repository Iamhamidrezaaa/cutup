/**
 * [semantic-segmentation] and [segmentation-comparison] diagnostic logs.
 */

export function logSemanticSegmentation(traceId, payload) {
  console.log(
    '[semantic-segmentation]',
    JSON.stringify({
      traceId: traceId || null,
      language: payload.language,
      domain: payload.domain,
      originalText: String(payload.originalText || '').slice(0, 200),
      generatedLines: payload.generatedLines,
      segmentationScore: payload.segmentationScore,
      breakReason: payload.breakReason
    })
  );
}

export function logSegmentationComparison(traceId, payload) {
  console.log(
    '[segmentation-comparison]',
    JSON.stringify({
      traceId: traceId || null,
      currentScore: payload.currentScore,
      semanticScore: payload.semanticScore,
      selectedVersion: payload.selectedVersion,
      language: payload.language || null,
      domain: payload.domain || null
    })
  );
}

/** Production uses legacy layout; semantic runs evaluation-only (shadow). */
export function logSemanticSegmentationDisabled(traceId, payload) {
  console.log(
    '[semantic-segmentation-disabled]',
    JSON.stringify({
      traceId: traceId || null,
      currentScore: payload.currentScore,
      semanticScore: payload.semanticScore,
      wouldHaveWon: Boolean(payload.wouldHaveWon),
      currentVersion: payload.currentVersion,
      semanticVersion: payload.semanticVersion,
      language: payload.language || null,
      domain: payload.domain || null
    })
  );
}
