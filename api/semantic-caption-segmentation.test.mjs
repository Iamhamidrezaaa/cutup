import { segmentCaptionSemantically } from './semantic-caption-segmentation.js';
import { compareAndSelectSegmentation, legacyStackToLines } from './segmentation-quality-score.js';

const layout = {
  mode: 'stack',
  wordsPerLineMin: 2,
  wordsPerLineMax: 6,
  maxCharsPerLine: 28,
  maxLines: 2
};

const enFitness = segmentCaptionSemantically({
  text: 'Nice deadlift, keep pushing',
  language: 'en',
  domain: 'fitness',
  layout
});
console.log('EN fitness', enFitness.lines, enFitness.breakReason, enFitness.segmentationScore);
const joined = enFitness.lines.join('|');
if (!joined.toLowerCase().includes('nice deadlift')) {
  console.error('FAIL: should keep Nice deadlift together', joined);
  process.exit(1);
}

const enClause = segmentCaptionSemantically({
  text: 'I just want to do this once with you',
  language: 'en',
  domain: 'general',
  layout: { ...layout, maxCharsPerLine: 22 }
});
console.log('EN clause', enClause.lines);

const legacy = legacyStackToLines('Nice deadlift keep pushing', layout);
const cmp = compareAndSelectSegmentation('Nice deadlift keep pushing', layout, {
  domain: 'fitness',
  persistTraining: false
});
console.log('compare', {
  legacy,
  semantic: cmp.semanticLines,
  selected: cmp.selectedVersion,
  currentScore: cmp.currentScore,
  semanticScore: cmp.semanticScore
});

console.log('ok');
