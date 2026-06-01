/**
 * [translation-competition] diagnostic logs.
 */

/**
 * @param {string} traceId
 * @param {object} entry
 * @param {number} entry.cueIndex
 * @param {number} entry.attemptId
 * @param {string} [entry.stage]
 * @param {number} entry.translationScore
 * @param {number} entry.meaningScore
 * @param {number} entry.fluencyScore
 * @param {boolean} [entry.winner]
 * @param {number} [entry.compositeScore]
 */
export function logTranslationCompetitionAttempt(traceId, entry) {
  console.log(
    '[translation-competition]',
    JSON.stringify({
      traceId,
      cueIndex: entry.cueIndex,
      attemptId: entry.attemptId,
      stage: entry.stage || null,
      translationScore: entry.translationScore,
      meaningScore: entry.meaningScore,
      fluencyScore: entry.fluencyScore,
      compositeScore: entry.compositeScore ?? null,
      winner: Boolean(entry.winner)
    })
  );
}

/**
 * @param {string} traceId
 * @param {object} summary
 */
export function logTranslationCompetitionSummary(traceId, summary) {
  console.log('[translation-competition]', JSON.stringify({ traceId, summary }));
}
