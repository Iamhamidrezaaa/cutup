import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSourceAlignedSubtitles,
  buildPhraseBurnSubtitles
} from './subtitle-pipeline.js';
import { generateAssContent } from './ass-generator.js';

test('viral export uses phrase burn path with more cues than source-aligned coalesce', () => {
  const segments = Array.from({ length: 15 }, (_, i) => ({
    start: 1.79 + i * 0.45,
    end: 1.79 + i * 0.45 + 0.4,
    text: `Word block number ${i} for phrase cadence test`
  }));

  const beforeCoalescePath = buildSourceAlignedSubtitles(segments);
  const phrasePath = buildPhraseBurnSubtitles(segments);
  assert.ok(phrasePath.length > beforeCoalescePath.length);

  const ass = generateAssContent(segments, 'mrBeast', { captionMode: 'viral' });
  assert.equal(ass.cueCount, phrasePath.length);
});

test('accurate mode keeps source-aligned segment path', () => {
  const segments = [{ start: 0, end: 1.2, text: 'one segment only' }];
  const aligned = buildSourceAlignedSubtitles(segments);
  const ass = generateAssContent(segments, 'mrBeast', { captionMode: 'accurate' });
  assert.equal(ass.cueCount, aligned.length);
});
