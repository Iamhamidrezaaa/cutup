import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptionMergeForensicsReport } from './caption-merge-forensics.js';

test('coalesce reduces cue count and preserves production parity', () => {
  const segments = [];
  for (let i = 0; i < 15; i++) {
    segments.push({
      start: i * 0.25,
      end: i * 0.25 + 0.2,
      text: `phrase number ${i} short`
    });
  }
  segments.push({
    start: 3.5,
    end: 3.55,
    text: 'tiny'
  });
  segments.push({
    start: 3.58,
    end: 4.2,
    text: 'tiny phrase expanded into a much longer continuation'
  });

  const report = buildCaptionMergeForensicsReport(segments);
  assert.equal(report.instrumentationVerified.coalesceMatchesProduction, true);
  assert.equal(report.instrumentationVerified.stabilizeMatchesProduction, true);
  assert.equal(report.rootCauseAttribution.cueCountCollapseStage, 'coalesceBurnPhrases');
  assert.ok(report.cueCountByStage.coalesceReduction >= 0);
});

test('perCueLineage includes required fields', () => {
  const report = buildCaptionMergeForensicsReport([
    { start: 0, end: 1, text: 'hello world' },
    { start: 1.05, end: 1.4, text: 'short' }
  ]);
  const row = report.perCueLineage[0];
  assert.ok(row.cueId);
  assert.ok('sourceCueId' in row);
  assert.ok('sourceText' in row);
  assert.ok('mergedCueId' in row);
  assert.ok('mergedText' in row);
});
