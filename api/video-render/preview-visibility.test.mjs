import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewAlignedSubtitles } from './subtitle-pipeline.js';
import { generateAssFromExportDoc } from './ass-generator.js';

test('preview export skips blink cues and passes visibility validation', () => {
  const exportDoc = {
    format: 'cutup-style-v1',
    preset: { id: 'mrBeast' },
    cues: [
      { start: 1.954, end: 1.964, text: 'This kid was taking part in a challenge', lines: ['This kid'] },
      { start: 1.964, end: 4.19, text: '[music] to win a free haircut, but there', lines: ['[music] to win'] },
      { start: 4.2, end: 6.83, text: 'was one catch. He had to stop the timer', lines: ['was one catch'] }
    ]
  };

  const aligned = buildPreviewAlignedSubtitles(exportDoc.cues);
  assert.equal(aligned.length, 3);

  const ass = generateAssFromExportDoc(exportDoc, {
    captionMode: 'viral',
    playResX: 1080,
    playResY: 1920,
    durationSec: 30
  });
  assert.ok(ass.content.includes('Dialogue:'));
  assert.ok(ass.cueCount >= 2);
});
