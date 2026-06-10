import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignCleanSrtToVideoSpeech,
  buildCleanSrtExactSubtitles,
  buildPreviewAlignedSubtitles,
  snapCleanSrtTimelineToZero,
  stripBurnNonSpeechTags
} from './subtitle-pipeline.js';
import { generateAssFromExportDoc } from './ass-generator.js';

test('clean SRT export keeps first cue text after uniform lead snap', () => {
  const cues = [
    { start: 1.954, end: 1.964, text: 'This kid was taking part in a challenge' },
    { start: 1.964, end: 4.19, text: '[music] to win a free haircut, but there' },
    { start: 21.51, end: 23.99, text: 'something [music] completely unexpected' }
  ];
  assert.ok(!stripBurnNonSpeechTags('[music] to win').includes('music'));

  const exact = buildCleanSrtExactSubtitles(cues);
  assert.equal(exact.length, 3);
  assert.equal(exact[0].start, 1.954);
  assert.equal(exact[1].start, 1.964);

  const lockedExact = exact.map((c, i) => ({
    ...c,
    id: `master-${i}`,
    locked: true,
    renderStart: c.start,
    renderEnd: c.end
  }));
  assert.equal(lockedExact[0].start, 1.954);
  assert.equal(lockedExact[1].start, 1.964);

  const aligned = buildPreviewAlignedSubtitles(cues);
  assert.ok(aligned.length >= 2);
  assert.ok(aligned[0].text.toLowerCase().includes('this kid'));
  assert.ok(!aligned[0].text.toLowerCase().includes('[music]'));

  const { cues: shifted, offsetSec } = snapCleanSrtTimelineToZero(aligned);
  assert.ok(offsetSec > 0.9);
  assert.ok(shifted[0].text.toLowerCase().includes('this kid'));
  assert.equal(shifted[0].start, 0);

  const exportDoc = {
    format: 'cutup-style-v1',
    preset: { id: 'mrBeast' },
    cues: cues.map((c, i) => ({
      id: `master-${i}`,
      index: i + 1,
      start: c.start,
      end: c.end,
      text: c.text,
      lines: [c.text],
      locked: true,
      stylePresetId: 'mrBeast'
    }))
  };
  const ass = generateAssFromExportDoc(exportDoc, {
    captionMode: 'viral',
    playResX: 1080,
    playResY: 1920,
    durationSec: 30
  });
  const plain = ass.content.replace(/\{[^}]*\}/g, '').toLowerCase();
  assert.ok(plain.includes('this kid'));
  const dialogues = ass.timingAudit?.assDialogues || [];
  const firstAss = dialogues[0];
  assert.ok(firstAss && firstAss.assStart === 1.954, 'ASS preserves master clean SRT start time');
  assert.equal(dialogues.length, cues.length);
});

test('alignCleanSrtToVideoSpeech shifts timeline to speech anchor', () => {
  const cues = [
    { start: 1.954, end: 4.19, text: 'This kid was taking part' },
    { start: 21.51, end: 23.99, text: 'something unexpected' }
  ];
  const { cues: shifted, offsetSec } = alignCleanSrtToVideoSpeech(cues, 1.12);
  assert.ok(offsetSec > 0.7);
  assert.ok(Math.abs(shifted[0].start - 1.12) < 0.06);
});
