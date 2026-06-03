import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhraseBurnSubtitles } from './subtitle-pipeline.js';
import { layoutLines } from './text-layout.js';

const VIRAL_LAYOUT = {
  maxLines: 1,
  wordsPerLineMin: 1,
  wordsPerLineMax: 8,
  maxCharsPerLine: 28,
  mode: 'single'
};

test('first cue starts at zero when first translated segment starts at zero', () => {
  const cues = buildPhraseBurnSubtitles([
    {
      start: 0,
      end: 2.4,
      text: 'سلام به همه',
      translatedSegmentId: 'tr-0',
      sourceSegmentId: 'src-0',
      words: [
        { word: 'سلام', start: 0, end: 0.5 },
        { word: 'به', start: 0.5, end: 0.9 },
        { word: 'همه', start: 0.9, end: 1.2 }
      ]
    }
  ]);
  assert.ok(cues.length >= 1);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].translatedSegmentId, 'tr-0');
  assert.equal(cues[0].sourceSegmentId, 'src-0');
});

test('phrase text is substring of translated segment text in segment order', () => {
  const segmentText = 'این یک جمله فارسی است';
  const cues = buildPhraseBurnSubtitles([
    {
      start: 1,
      end: 4,
      text: segmentText,
      translatedSegmentId: 'tr-fa',
      words: [
        { word: 'است', start: 3.5, end: 4 },
        { word: 'فارسی', start: 2.8, end: 3.2 },
        { word: 'جمله', start: 2.1, end: 2.5 },
        { word: 'یک', start: 1.6, end: 1.9 },
        { word: 'این', start: 1, end: 1.3 }
      ]
    }
  ]);
  const joined = cues.map((c) => c.text).join(' ');
  assert.equal(joined, segmentText);
  for (const cue of cues) {
    assert.ok(segmentText.includes(cue.text));
    assert.deepEqual(cue.words, cue.text.split(/\s+/));
    assert.equal(cue.translatedSegmentId, 'tr-fa');
  }
});

test('viral phrase cues are single-line (split into more cues instead)', () => {
  const longText =
    'SEE THIS MAN SEEMS TO BE CLIMBING UP CONFUSING TO IT IS YOU BE';
  const cues = buildPhraseBurnSubtitles([
    { start: 2, end: 8, text: longText, translatedSegmentId: 'tr-en' }
  ]);
  assert.ok(cues.length > 1);
  for (const cue of cues) {
    const lines = layoutLines(cue.text, VIRAL_LAYOUT);
    assert.ok(lines.length <= 1, `expected 1 line, got ${lines.length} for "${cue.text}"`);
  }
});

test('each phrase cue maps to one translated segment id (no index-only reassignment)', () => {
  const cues = buildPhraseBurnSubtitles([
    { start: 0, end: 1.5, text: 'اول', translatedSegmentId: 'a', sourceSegmentId: 'a' },
    { start: 1.6, end: 3, text: 'دوم', translatedSegmentId: 'b', sourceSegmentId: 'b' }
  ]);
  assert.equal(cues.filter((c) => c.translatedSegmentId === 'a').length, 1);
  assert.equal(cues.filter((c) => c.translatedSegmentId === 'b').length, 1);
});
