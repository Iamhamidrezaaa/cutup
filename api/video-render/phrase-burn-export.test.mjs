import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceAlignedSubtitles } from './subtitle-pipeline.js';
import { generateAssContent } from './ass-generator.js';

test('viral export uses master locked cues without phrase re-segmentation', () => {
  const segments = Array.from({ length: 4 }, (_, i) => ({
    id: `master-${i}`,
    start: 1.79 + i * 0.45,
    end: 1.79 + i * 0.45 + 0.4,
    text: `Cue ${i} text.`,
    locked: true
  }));

  const ass = generateAssContent(segments, 'mrBeast', { captionMode: 'viral' });
  assert.equal(ass.cueCount, segments.length);
  for (let i = 0; i < segments.length; i++) {
    const dlg = ass.timingAudit.assDialogues[i];
    assert.equal(dlg.assStart, segments[i].start);
    assert.equal(dlg.assEnd, segments[i].end);
  }
});

test('accurate mode keeps source-aligned segment path', () => {
  const segments = [{ start: 0, end: 1.2, text: 'one segment only' }];
  const aligned = buildSourceAlignedSubtitles(segments);
  const ass = generateAssContent(segments, 'mrBeast', { captionMode: 'accurate' });
  assert.equal(ass.cueCount, aligned.length);
});
