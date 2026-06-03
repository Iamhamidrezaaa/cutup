import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateRtlFirstWordToLineEndForAss } from './rtl-ass-bidi.js';
import { generateAssContent } from './ass-generator.js';

test('rotateRtlFirstWordToLineEndForAss moves only first word to end', () => {
  const out = rotateRtlFirstWordToLineEndForAss('وقتی که داشت حرکتش رو انجام می داد');
  assert.equal(out, 'که داشت حرکتش رو انجام می داد وقتی');
});

test('RTL burn keeps middle word order and places first word at line end', () => {
  const line = 'وقتی که داشت حرکتش رو انجام می داد';
  const { content } = generateAssContent(
    [{ start: 0, end: 4, text: line }],
    'alexHormozi',
    { captionMode: 'viral', strictCleanSrtTimings: true, durationSec: 30 }
  );
  const dialogue = content.split('\n').find((l) => l.startsWith('Dialogue:'));
  const textField = dialogue.split(',').slice(9).join(',');
  const whenIdx = textField.indexOf('وقتی');
  const thatIdx = textField.indexOf('که');
  const hadIdx = textField.indexOf('داشت');
  assert.ok(thatIdx >= 0 && hadIdx >= 0 && whenIdx >= 0);
  assert.ok(thatIdx < hadIdx, 'که before داشت — middle order preserved');
  assert.ok(whenIdx > thatIdx, 'وقتی at end of ASS string for physical right');
  assert.match(textField, /\{\\c&H/i);
  const colorAt = textField.indexOf('{\\c');
  assert.ok(colorAt >= 0 && colorAt < whenIdx + 8, 'highlight on first sentence word');
});
