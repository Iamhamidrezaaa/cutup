/**
 * Translation job telemetry (diagnostics only — no UI).
 */

/**
 * @param {object} data
 * @param {string} [data.traceId]
 * @param {string} data.detectedLanguage
 * @param {number} data.languageConfidence
 * @param {number} data.translationScore
 * @param {number} data.meaningScore
 * @param {number} data.fluencyScore
 * @param {boolean} data.rewritten
 * @param {number} data.cueCount
 * @param {number} [data.initialScore]
 * @param {number} [data.rewrittenScore]
 * @param {boolean} [data.languageNeedsReview]
 * @param {string} [data.detectedBy]
 */
export function buildTranslationTelemetry(data) {
  return {
    traceId: data.traceId || null,
    detectedLanguage: data.detectedLanguage ?? 'unknown',
    languageConfidence: Number(data.languageConfidence ?? 0),
    translationScore: Number(data.translationScore ?? 0),
    meaningScore: Number(data.meaningScore ?? 0),
    fluencyScore: Number(data.fluencyScore ?? 0),
    rewritten: Boolean(data.rewritten),
    cueCount: Number(data.cueCount ?? 0),
    initialScore: data.initialScore != null ? Number(data.initialScore) : undefined,
    rewrittenScore: data.rewrittenScore != null ? Number(data.rewrittenScore) : undefined,
    languageNeedsReview: Boolean(data.languageNeedsReview),
    detectedBy: data.detectedBy || null
  };
}

/**
 * @param {string} traceId
 * @param {ReturnType<typeof buildTranslationTelemetry>} telemetry
 */
export function logTranslationQuality(traceId, telemetry) {
  console.log(
    '[translation-quality]',
    JSON.stringify(
      {
        traceId,
        ...telemetry
      },
      null,
      0
    )
  );
}
