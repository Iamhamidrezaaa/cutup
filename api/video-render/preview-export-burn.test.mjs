import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhraseBurnSubtitles, buildPreviewAlignedSubtitles } from './subtitle-pipeline.js';
import { generateAssFromExportDoc } from './ass-generator.js';

test('exportDoc preview burn preserves cue text and line layout', () => {
  const exportDoc = {
    format: 'cutup-style-v1',
    preset: { id: 'mrBeast' },
    cues: [
      {
        start: 1,
        end: 3.2,
        text: 'THIS KID WAS TAKING PART IN A CHALLENGE',
        lines: ['THIS KID WAS', 'TAKING PART IN A CHALLENGE']
      },
      {
        start: 1.1,
        end: 4,
        text: '[MUSIC] TO WIN A FREE HAIRCUT, BUT THERE',
        lines: ['[MUSIC] TO WIN', 'A FREE HAIRCUT, BUT THERE']
      }
    ]
  };

  const previewCues = buildPreviewAlignedSubtitles(
    exportDoc.cues.map((c) => ({
      start: c.start,
      end: c.end,
      text: c.text,
      previewLines: c.lines
    }))
  );
  assert.equal(previewCues[0].text, exportDoc.cues[0].text);
  assert.deepEqual(previewCues[0].previewLines, exportDoc.cues[0].lines);

  const phraseFromSame = buildPhraseBurnSubtitles(
    exportDoc.cues.map((c) => ({ start: c.start, end: c.end, text: c.text }))
  );
  assert.notEqual(phraseFromSame.length, previewCues.length);

  const ass = generateAssFromExportDoc(exportDoc, {
    captionMode: 'viral',
    playResX: 1080,
    playResY: 1920,
    durationSec: 30
  });
  assert.equal(ass.cueCount, exportDoc.cues.length);
  assert.equal(ass.captionMode, 'viral');
});
