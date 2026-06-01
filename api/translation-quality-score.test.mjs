import { scoreTranslationPair, exampleQualityScores, scoreTranslationBatch } from './translation-quality-score.js';

const examples = exampleQualityScores();
console.log('literal deadlift', examples.literalDeadlift);
console.log('natural deadlift', examples.naturalDeadlift);
console.log('lets go', examples.letsGo);

if (!examples.literalDeadlift.needsRewrite) {
  console.error('FAIL: literal should need rewrite');
  process.exit(1);
}
if (examples.naturalDeadlift.translationScore < examples.literalDeadlift.translationScore) {
  console.error('FAIL: natural should score higher than literal');
  process.exit(1);
}

const batch = scoreTranslationBatch(
  [{ text: 'Nice deadlift' }, { text: "Let's go" }],
  [{ text: 'ددلیفت خوبی است' }, { text: 'بزن بریم' }],
  { sourceLanguage: 'en', targetLanguage: 'fa' }
);
console.log('batch score', batch.translationScore, 'needsRewrite', batch.needsRewrite);
console.log('ok');
