import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAssFromExportDoc } from './ass-generator.js';

test('preview export keeps layout line order top-to-bottom like UI preview', () => {
  const exportDoc = {
    format: 'cutup-style-v1',
    preset: { id: 'mrBeast' },
    cues: [
      {
        start: 1.964,
        end: 4.19,
        text: '[music] to win a free haircut, but there',
        lines: ['[MUSIC] TO WIN', 'A FREE HAIRCUT,', 'BUT THERE']
      }
    ]
  };

  const ass = generateAssFromExportDoc(exportDoc, {
    captionMode: 'viral',
    playResX: 1080,
    playResY: 1920,
    durationSec: 30
  });

  const plain = ass.content.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '|');
  const idxMusic = plain.indexOf('[MUSIC]');
  const idxBut = plain.indexOf('BUT');
  assert.ok(idxMusic >= 0 && idxBut > idxMusic);
});
