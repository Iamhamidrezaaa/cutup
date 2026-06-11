import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCleanSrtWordIntegrity,
  buildCleanSrtWordLossReport,
  extractNormalizedWords,
  normalizePostProcessedForCleanSrt
} from './clean-srt-word-integrity.js';
import { buildMasterCleanSrtFromSegments } from './master-subtitle-cues.js';
import {
  segmentPreparedSegmentsToMasterCues,
  VERTICAL_SHORT_FORM_MAX_CHARS,
  VERTICAL_SHORT_FORM_MAX_WORDS
} from './master-clean-srt-segmentation.js';

const EXAMPLE_TEXT =
  'What kidding challenge with you guys that lifting very nice. No, just challenge';

test('zero word loss: example sentence splits into three cues with all words preserved', () => {
  const postProcessed = [
    {
      start: 0,
      end: 8,
      text: EXAMPLE_TEXT
    }
  ];
  const clean = segmentPreparedSegmentsToMasterCues(normalizePostProcessedForCleanSrt(postProcessed));
  assert.equal(clean.length, 3);
  assert.equal(clean[0].text, 'What kidding challenge with you');
  assert.equal(clean[1].text, 'guys that lifting very nice');
  assert.equal(clean[2].text, 'No just challenge');

  const report = buildCleanSrtWordLossReport(postProcessed, clean);
  assert.equal(report.ok, true);
  assert.equal(report.missingWords.length, 0);

  const sourceWords = extractNormalizedWords(postProcessed);
  const cleanWords = extractNormalizedWords(clean);
  assert.deepEqual(cleanWords, sourceWords);
});

test('buildMasterCleanSrtFromSegments validates joined word text matches post-processed', () => {
  const postProcessed = [
    { start: 0, end: 3, text: 'Hello world today' },
    { start: 3.5, end: 6, text: 'more words here' }
  ];
  const locked = buildMasterCleanSrtFromSegments(postProcessed, { shortForm: true });
  assert.ok(locked.length >= 2);
  assert.ok(locked.every((c) => c.locked === true));
  assert.doesNotThrow(() => assertCleanSrtWordIntegrity(postProcessed, locked));
});

test('assertCleanSrtWordIntegrity throws and reports missing words', () => {
  const postProcessed = [{ start: 0, end: 2, text: 'one two three' }];
  const cleanSrt = [{ start: 0, end: 1, text: 'one two' }];
  assert.throws(
    () => assertCleanSrtWordIntegrity(postProcessed, cleanSrt),
    (err) => err.code === 'SUBTITLE_WORD_LOSS' && err.report.missingWords.length > 0
  );
});

test('vertical short-form caps at three words and twelve chars per cue', () => {
  const postProcessed = [
    {
      start: 0,
      end: 6,
      text: 'THIS IS MY STICK FOR CLEANING YOU CAN TRY IT'
    }
  ];
  const clean = segmentPreparedSegmentsToMasterCues(normalizePostProcessedForCleanSrt(postProcessed), {
    maxWords: VERTICAL_SHORT_FORM_MAX_WORDS,
    maxChars: VERTICAL_SHORT_FORM_MAX_CHARS
  });
  assert.ok(clean.length >= 4);
  for (const cue of clean) {
    const wc = cue.text.split(/\s+/).filter(Boolean).length;
    assert.ok(wc <= VERTICAL_SHORT_FORM_MAX_WORDS);
    assert.ok(cue.text.length <= VERTICAL_SHORT_FORM_MAX_CHARS + 4);
  }
  const report = buildCleanSrtWordLossReport(postProcessed, clean);
  assert.equal(report.ok, true);
});

test('normalizePostProcessedForCleanSrt does not merge rolling segments', () => {
  const raw = [
    { start: 0, end: 1, text: 'Hello' },
    { start: 1, end: 2, text: 'Hello world' }
  ];
  const out = normalizePostProcessedForCleanSrt(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, 'Hello');
  assert.equal(out[1].text, 'Hello world');
});
