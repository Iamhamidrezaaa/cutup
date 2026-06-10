import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSegmentToMasterCues } from './master-clean-srt-segmentation.js';
import {
  applyTranslationToLockedCues,
  assertLockedCueImmutable,
  buildMasterCleanSrtFromSegments,
  lockMasterCues,
  validateMasterVsAss
} from './master-subtitle-cues.js';
import { generateAssContent } from './ass-generator.js';

test('short-form segmentation splits at punctuation and respects max words', () => {
  const pieces = segmentSegmentToMasterCues({
    start: 0,
    end: 6,
    text: 'Hello world, this is a longer phrase for testing.'
  });
  assert.ok(pieces.length >= 2);
  for (const p of pieces) {
    const words = p.text.split(/\s+/).filter(Boolean);
    assert.ok(words.length <= 5);
    assert.ok(p.text.length <= 42);
    assert.ok(p.end > p.start);
  }
});

test('locked cues reject timing mutation', () => {
  const locked = lockMasterCues([{ start: 1, end: 2, text: 'hello' }])[0];
  assert.throws(
    () => assertLockedCueImmutable(locked, { ...locked, start: 1.5 }, 'export'),
    /subtitle_lock_violation/
  );
});

test('translation updates text only on locked cues', () => {
  const master = lockMasterCues([
    { start: 0, end: 1.2, text: 'hello' },
    { start: 1.2, end: 2.4, text: 'world' }
  ]);
  const translated = applyTranslationToLockedCues(master, [
    { start: 9, end: 9.9, text: 'سلام' },
    { start: 9.9, end: 10.8, text: 'دنیا' }
  ]);
  assert.equal(translated.length, 2);
  assert.equal(translated[0].start, 0);
  assert.equal(translated[0].end, 1.2);
  assert.equal(translated[0].text, 'سلام');
  assert.equal(translated[1].locked, true);
});

test('viral MP4 export keeps master clean SRT cue count and timing', () => {
  const segments = [
    { id: 'master-0', start: 1.2, end: 2.1, text: 'Short first cue.', locked: true },
    { id: 'master-1', start: 2.1, end: 3.4, text: 'Second line here.', locked: true }
  ];
  const ass = generateAssContent(segments, 'mrBeast', { captionMode: 'viral' });
  assert.equal(ass.cueCount, 2);
  const validation = validateMasterVsAss(segments, ass.timingAudit.assDialogues);
  assert.equal(validation.ok, true);
});

test('buildMasterCleanSrtFromSegments locks output cues', () => {
  const master = buildMasterCleanSrtFromSegments([
    { start: 0, end: 4, text: 'One two three four five six seven eight.' }
  ]);
  assert.ok(master.length >= 2);
  assert.equal(master[0].locked, true);
  assert.ok(master.every((c) => c.id && c.locked === true));
});
