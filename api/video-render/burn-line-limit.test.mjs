import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCueLines } from './text-layout.js';
import { resolveCueLineLayout, BURN_SUBTITLE_MAX_LINES } from './layout-engine.js';
import { expandCueVisualChunks } from './subtitle-pipeline.js';
import { generateAssFromExportDoc } from './ass-generator.js';

test('burn layout uses a single ASS line per dialogue', () => {
  const base = {
    mode: 'stack',
    wordsPerLineMin: 2,
    wordsPerLineMax: 4,
    maxCharsPerLine: 18,
    maxLines: 1
  };
  const layout = resolveCueLineLayout(base, 'WHEN HE WAS ABOUT TO MAKE HIS MOVE');
  const lines = buildCueLines(
    { text: 'WHEN HE WAS ABOUT TO MAKE HIS MOVE' },
    layout,
    true
  );
  assert.equal(BURN_SUBTITLE_MAX_LINES, 1);
  assert.equal(lines.length, 1);
});

test('expandCueVisualChunks splits long cues without changing first chunk start', () => {
  const input = [
    {
      id: 'srt-0',
      text: 'when he was about to make his move exactly',
      sourceStart: 10,
      sourceEnd: 14,
      renderStart: 10,
      renderEnd: 14
    }
  ];
  const out = expandCueVisualChunks(input);
  assert.ok(out.length > 1);
  assert.equal(out[0].renderStart, 10);
  assert.ok(out[0].text.split(/\s+/).length <= 5);
});

test('export ASS collapses multi-line exportDoc cues to one row', () => {
  const exportDoc = {
    format: 'cutup-style-v1',
    preset: { id: 'alexHormozi' },
    cues: [
      {
        start: 5,
        end: 9,
        text: 'when he was about to make his move exactly now',
        lines: ['WHEN HE WAS ABOUT', 'TO MAKE HIS MOVE EXACTLY NOW']
      }
    ]
  };
  const ass = generateAssFromExportDoc(exportDoc, {
    captionMode: 'viral',
    playResX: 1080,
    playResY: 1920,
    durationSec: 30
  });
  const dialogue = ass.content.split('\n').find((l) => l.startsWith('Dialogue:'));
  assert.ok(dialogue);
  const textField = dialogue.split(',').slice(9).join(',');
  const rowCount = textField.split('\\N').length;
  assert.equal(rowCount, 1, `expected 1 row, got ${rowCount}`);
});
