import test from 'node:test';
import assert from 'node:assert/strict';
import {
  polishMasterCueTimeline,
  speechBoundsFromCue,
  BURN_LIP_LEAD_SEC,
  BURN_INTER_CUE_GAP_SEC
} from './master-cue-sync-polish.js';
import { segmentSegmentToMasterCues } from './master-clean-srt-segmentation.js';

test('polishMasterCueTimeline uses word start with lip lead, not segment delay', () => {
  const out = polishMasterCueTimeline([
    {
      start: 1,
      end: 2.8,
      text: 'hello world',
      words: [
        { word: 'hello', start: 1.2, end: 1.5 },
        { word: 'world', start: 1.55, end: 1.9 }
      ]
    },
    { start: 2.6, end: 4, text: 'next phrase' }
  ]);
  assert.ok(out[0].start <= 1.2, 'starts near first word, not after segment envelope');
  assert.ok(out[0].start >= 1.2 - BURN_LIP_LEAD_SEC - 0.001);
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
  const nextVisible = 2.05 - BURN_LIP_LEAD_SEC;
  assert.ok(out[0].end <= nextVisible - BURN_INTER_CUE_GAP_SEC + 0.001);
});

test('segmentSegmentToMasterCues preserves question mark on cue text', () => {
  const cues = segmentSegmentToMasterCues({
    start: 10,
    end: 12,
    text: 'May I sit here?',
    words: [
      { word: 'May', start: 10.1, end: 10.3 },
      { word: 'I', start: 10.35, end: 10.45 },
      { word: 'sit', start: 10.5, end: 10.7 },
      { word: 'here', start: 10.75, end: 11.0 }
    ]
  });
  assert.equal(cues.length, 1);
  assert.match(cues[0].text, /\?$/);
});
