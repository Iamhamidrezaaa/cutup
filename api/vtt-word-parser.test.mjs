import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVttToSegmentsWithWords } from './vtt-word-parser.js';

test('parses inline VTT word timestamps', () => {
  const vtt = `WEBVTT

00:00:44.000 --> 00:00:46.500
We're <00:00:44.100>now <00:00:44.400>at <00:00:44.700>a <00:00:45.000>point <00:00:45.350>of <00:00:45.700>no <00:00:46.000>return
`;
  const { segments, hasInlineTiming, hasWordTiming } = parseVttToSegmentsWithWords(vtt);
  assert.ok(segments.length >= 1);
  assert.equal(hasInlineTiming, true);
  assert.equal(hasWordTiming, true);
  const words = segments[0].words || [];
  assert.ok(words.length >= 6);
  assert.equal(words[0].word, "We're");
  assert.ok(words[1].start > words[0].start);
});
