import test from 'node:test';
import assert from 'node:assert/strict';
import {
  polishMasterCueTimeline,
  speechBoundsFromCue,
  BURN_ONSET_DELAY_SEC,
  BURN_INTER_CUE_GAP_SEC
} from './master-cue-sync-polish.js';

test('polishMasterCueTimeline delays onset and clips before next cue', () => {
  const out = polishMasterCueTimeline([
    { start: 1, end: 2.5, text: 'hello world' },
    { start: 2.6, end: 4, text: 'next phrase' }
  ]);
  assert.ok(out[0].start > 1, 'first cue starts after speech onset');
  assert.ok(out[0].end < out[1].start, 'first cue ends before second appears');
});

test('speechBoundsFromCue uses word timestamps not segment envelope', () => {
  const bounds = speechBoundsFromCue({
    start: 1,
    end: 3,
    words: [
      { word: 'hello', start: 1.4, end: 1.7 },
      { word: 'world', start: 1.75, end: 2.1 }
    ]
  });
  assert.equal(bounds.speechStart, 1.4);
  assert.equal(bounds.speechEnd, 2.1);
});

test('polishMasterCueTimeline clips at next word onset not loose segment start', () => {
  const out = polishMasterCueTimeline([
    {
      start: 1,
      end: 2.8,
      text: 'first line here',
      words: [
        { word: 'first', start: 1.0, end: 1.3 },
        { word: 'line', start: 1.35, end: 1.6 },
        { word: 'here', start: 1.65, end: 1.95 }
      ]
    },
    {
      start: 1.5,
      end: 4,
      text: 'next phrase now',
      words: [
        { word: 'next', start: 2.05, end: 2.3 },
        { word: 'phrase', start: 2.35, end: 2.7 },
        { word: 'now', start: 2.75, end: 3.1 }
      ]
    }
  ]);
  const nextVisible = 2.05 + BURN_ONSET_DELAY_SEC;
  assert.ok(out[0].end <= nextVisible - BURN_INTER_CUE_GAP_SEC + 0.001);
  assert.ok(out[0].start >= 1.0 + BURN_ONSET_DELAY_SEC - 0.001);
});
