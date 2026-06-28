import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterProviderWords,
  filterUnreliableAsrSegments,
  isKnownHallucinationText,
  isUnreliableAsrSegment
} from './asr-quality-filter.js';

test('isKnownHallucinationText flags outro phrases', () => {
  assert.equal(isKnownHallucinationText('Thanks for watching!'), true);
  assert.equal(isKnownHallucinationText('hello world'), false);
});

test('isUnreliableAsrSegment uses no_speech_prob and logprob', () => {
  assert.equal(
    isUnreliableAsrSegment({
      start: 40,
      end: 44,
      text: 'random invented speech here',
      avg_logprob: -1.4,
      no_speech_prob: 0.2
    }),
    true
  );
  assert.equal(
    isUnreliableAsrSegment({
      start: 10,
      end: 12,
      text: 'real speech',
      avg_logprob: -0.2,
      no_speech_prob: 0.1
    }),
    false
  );
});

test('filterUnreliableAsrSegments removes known hallucinations', () => {
  const { segments, stats } = filterUnreliableAsrSegments([
    { start: 0, end: 2, text: 'hello', avg_logprob: -0.1, no_speech_prob: 0.05 },
    { start: 40, end: 43, text: 'Thanks for watching', avg_logprob: -0.3, no_speech_prob: 0.1 }
  ]);
  assert.equal(segments.length, 1);
  assert.equal(stats.removedCount, 1);
});

test('filterProviderWords drops orphan words in long silence tail', () => {
  const segments = [
    { start: 0, end: 38, text: 'good speech', avg_logprob: -0.2, no_speech_prob: 0.05 }
  ];
  const words = [
    { word: 'good', start: 1, end: 1.4 },
    { word: 'speech', start: 1.4, end: 1.9 },
    { word: 'hallucinated', start: 45, end: 45.5 }
  ];
  const kept = filterProviderWords(words, segments);
  assert.deepEqual(kept.map((w) => w.word), ['good', 'speech']);
});
