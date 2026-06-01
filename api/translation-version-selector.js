/**
 * Select best translation attempt by weighted composite score.
 * Weights: 50% meaning, 30% fluency, 20% translationScore
 */

export const SELECTION_WEIGHTS = {
  meaningScore: 0.5,
  fluencyScore: 0.3,
  translationScore: 0.2
};

/**
 * @param {{ meaningScore?: number, fluencyScore?: number, translationScore?: number }} version
 */
export function compositeSelectionScore(version) {
  const meaning = Number(version?.meaningScore ?? 0);
  const fluency = Number(version?.fluencyScore ?? 0);
  const translation = Number(version?.translationScore ?? 0);
  return (
    meaning * SELECTION_WEIGHTS.meaningScore +
    fluency * SELECTION_WEIGHTS.fluencyScore +
    translation * SELECTION_WEIGHTS.translationScore
  );
}

/**
 * @param {object[]} versions — each must include attemptId, text, scores
 * @returns {{ bestVersion: object, compositeScore: number, ranked: object[] }}
 */
export function selectBestVersion(versions) {
  const list = (versions || []).filter((v) => v && String(v.text || '').trim());
  if (!list.length) {
    return { bestVersion: null, compositeScore: 0, ranked: [] };
  }

  const ranked = list
    .map((v) => ({
      ...v,
      compositeScore: Number(compositeSelectionScore(v).toFixed(2))
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore);

  const best = ranked[0];
  return {
    bestVersion: best,
    compositeScore: best.compositeScore,
    ranked
  };
}
