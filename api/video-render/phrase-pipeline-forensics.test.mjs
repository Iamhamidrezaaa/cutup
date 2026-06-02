import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhrasePipelineForensicsReport } from './phrase-pipeline-forensics.js';

test('phrase pipeline report includes aggregate counts', () => {
  const segments = Array.from({ length: 15 }, (_, i) => ({
    start: i * 0.4,
    end: i * 0.4 + 0.35,
    text: `segment ${i} with some words here`
  }));

  const report = buildPhrasePipelineForensicsReport(segments, { presetId: 'mrBeast' });
  assert.equal(report.aggregateCounts.sourceSegmentCount, 15);
  assert.ok(report.aggregateCounts.phraseCountRhythmPathShadow > 0);
  assert.equal(report.aggregateCounts.assDialogueCount, report.aggregateCounts.segmentCountFinalCanonical);
  assert.equal(
    report.first10Captions.length,
    Math.min(10, report.aggregateCounts.segmentCountFinalCanonical)
  );
  assert.ok(report.wherePhraseCaptionsDisappear.length >= 3);
});
