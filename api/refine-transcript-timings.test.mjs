import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refineTranscriptTimings,
  applyTightSpeechSync,
  roundTimelineSec,
  segmentsHaveWordTimestamps
} from './refine-transcript-timings.js';

test('roundTimelineSec keeps millisecond precision', () => {
  assert.equal(roundTimelineSec(1.23456), 1.235);
});

test('refineTranscriptTimings anchors to first/last word', () => {
  const input = [
    {
      start: 0.5,
      end: 2.2,
      text: 'hello world',
      words: [
        { word: 'hello', start: 0.52, end: 0.91 },
        { word: 'world', start: 0.95, end: 1.28 }
      ]
    }
  ];
  const out = refineTranscriptTimings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, 0.52);
  assert.equal(out[0].end, 1.34);
  assert.equal(segmentsHaveWordTimestamps(input), true);
});

test('applyTightSpeechSync uses audio anchors for translated cues', () => {
  const out = applyTightSpeechSync([
    { start: 0.1, end: 0.2, text: 'سلام', _audioStart: 0.82, _audioEnd: 1.15 }
  ]);
  assert.equal(out[0].start, 0.82);
  assert.equal(out[0].end, 1.21);
});
