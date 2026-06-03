import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectWhisperLeadingOffsetSec,
  applyWhisperLeadingOffsetIfNeeded
} from './whisper-leading-offset.js';

test('detects uniform Whisper lead of ~1.8s', () => {
  const segments = [
    {
      start: 1.82,
      end: 4.2,
      text: 'hello world',
      words: [
        { word: 'hello', start: 1.82, end: 2.1 },
        { word: 'world', start: 2.1, end: 2.4 }
      ]
    },
    { start: 4.3, end: 6, text: 'next phrase' }
  ];
  const offset = detectWhisperLeadingOffsetSec(segments);
  assert.ok(offset >= 1.7 && offset <= 1.9);
});

test('shifts timeline so first segment starts at zero', () => {
  const segments = [{ start: 1.5, end: 3, text: 'one' }, { start: 3.1, end: 5, text: 'two' }];
  const { segments: out, offsetSec } = applyWhisperLeadingOffsetIfNeeded(segments);
  assert.ok(offsetSec > 0);
  assert.equal(out[0].start, 0);
  assert.ok(out[1].start < 2);
});

test('does not shift when speech truly starts late', () => {
  const segments = [{ start: 0.1, end: 2, text: 'ok' }];
  const offset = detectWhisperLeadingOffsetSec(segments);
  assert.equal(offset, 0);
});
