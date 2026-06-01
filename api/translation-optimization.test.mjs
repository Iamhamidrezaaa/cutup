import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBackTranslationSampleIndices,
  EARLY_ACCEPT_THRESHOLD,
  createScoreCache
} from './translation-optimization.js';

test('pickBackTranslationSampleIndices first middle last', () => {
  assert.deepEqual(pickBackTranslationSampleIndices(2), [0, 1]);
  assert.deepEqual(pickBackTranslationSampleIndices(10), [0, 1, 2, 4, 5, 6, 7, 8, 9]);
  assert.ok(pickBackTranslationSampleIndices(100).length <= 9);
});

test('score cache returns same result for identical input', () => {
  const cache = createScoreCache();
  let calls = 0;
  const a = cache.get('a', 'b', null, () => {
    calls += 1;
    return { translationScore: 90 };
  });
  const b = cache.get('a', 'b', null, () => {
    calls += 1;
    return { translationScore: 50 };
  });
  assert.equal(a.translationScore, 90);
  assert.equal(b.translationScore, 90);
  assert.equal(calls, 1);
});

test('EARLY_ACCEPT_THRESHOLD is at least 88', () => {
  assert.ok(EARLY_ACCEPT_THRESHOLD >= 88);
});
