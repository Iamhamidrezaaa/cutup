import { selectBestVersion, compositeSelectionScore } from './translation-version-selector.js';

const versions = [
  { attemptId: 1, text: 'ددلیفت خوبی است', translationScore: 53, meaningScore: 48, fluencyScore: 60 },
  { attemptId: 2, text: 'ددلیفتت عالیه', translationScore: 83, meaningScore: 78, fluencyScore: 88 },
  { attemptId: 3, text: 'ددلیفتت خیلی خوبه', translationScore: 80, meaningScore: 85, fluencyScore: 86 }
];

const { bestVersion } = selectBestVersion(versions);
console.log('winner attempt', bestVersion.attemptId, 'composite', compositeSelectionScore(bestVersion));
if (bestVersion.attemptId !== 2 && bestVersion.attemptId !== 3) {
  console.error('FAIL: expected attempt 2 or 3 to win');
  process.exit(1);
}
console.log('ok');
