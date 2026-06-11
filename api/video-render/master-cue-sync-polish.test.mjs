import test from 'node:test';
import assert from 'node:assert/strict';
import { polishMasterCueTimeline } from './master-cue-sync-polish.js';

test('polishMasterCueTimeline delays onset and clips before next cue', () => {
  const out = polishMasterCueTimeline([
    { start: 1, end: 2.5, text: 'hello world' },
    { start: 2.6, end: 4, text: 'next phrase' }
  ]);
  assert.ok(out[0].start > 1, 'first cue starts after speech onset');
  assert.ok(out[0].end < out[1].start, 'first cue ends before second appears');
});
