import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSubtitleIntegrityReport,
  cloneSegmentsForAudit,
  compareSegmentStages,
  computeStageMetrics,
  findSuspiciousGaps
} from './subtitle-integrity-audit.js';

test('computeStageMetrics aggregates counts', () => {
  const m = computeStageMetrics([
    { start: 0, end: 1, text: 'hello world' },
    { start: 2, end: 3.5, text: 'second cue' }
  ]);
  assert.equal(m.segmentCount, 2);
  assert.equal(m.wordCount, 4);
  assert.ok(m.characterCount > 10);
  assert.equal(m.totalDurationCovered, 2.5);
});

test('compareSegmentStages detects removed segment', () => {
  const before = [
    { start: 0, end: 1, text: 'first' },
    { start: 1.2, end: 2.2, text: 'missing later' }
  ];
  const after = [{ start: 0, end: 1, text: 'first' }];
  const { removedSegments } = compareSegmentStages(before, after);
  assert.equal(removedSegments.length, 1);
  assert.equal(removedSegments[0].text, 'missing later');
});

test('findSuspiciousGaps flags gap with reference speech', () => {
  const clean = [
    { start: 0, end: 1, text: 'A' },
    { start: 4, end: 5, text: 'B' }
  ];
  const raw = [
    { start: 0, end: 1, text: 'A' },
    { start: 1.5, end: 2.5, text: 'spoken in gap' },
    { start: 4, end: 5, text: 'B' }
  ];
  const gaps = findSuspiciousGaps(clean, raw);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].gapSec > 1.5);
});

test('buildSubtitleIntegrityReport shape', () => {
  const report = buildSubtitleIntegrityReport({
    traceId: 't1',
    rawProvider: [{ start: 0, end: 1, text: 'hi' }],
    postProcessed: [{ start: 0, end: 1, text: 'hi' }],
    cleanSrt: [{ start: 0, end: 1, text: 'hi', locked: true }],
    exportedSegments: [{ start: 0, end: 1, text: 'hi' }]
  });
  assert.equal(report.rawSegments, 1);
  assert.equal(report.cleanedSegments, 1);
  assert.equal(report.exportedSegments, 1);
  assert.ok(Array.isArray(report.removedSegments));
  assert.ok(Array.isArray(report.suspiciousGaps));
  assert.equal(report.exportMatchesCleanSrt, true);
});

test('cloneSegmentsForAudit strips empty cues', () => {
  const out = cloneSegmentsForAudit([
    { start: 0, end: 1, text: 'ok' },
    { start: 2, end: 3, text: '   ' }
  ]);
  assert.equal(out.length, 1);
});
