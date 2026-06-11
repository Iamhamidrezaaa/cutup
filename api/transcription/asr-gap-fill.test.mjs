import test from 'node:test';
import assert from 'node:assert/strict';
import { findTimelineGaps } from './asr-gap-fill.js';

test('findTimelineGaps detects 12-18 style hole', () => {
  const gaps = findTimelineGaps([
    { start: 8.88, end: 12.08, text: 'challenge you' },
    { start: 18.679, end: 20.679, text: 'deadlifting' }
  ]);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].durationSec >= 6);
  assert.equal(Number(gaps[0].start.toFixed(2)), 12.08);
});
