import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationPerformanceTracker } from './translation-performance.js';

test('createTranslationPerformanceTracker aggregates stages and slowest', async () => {
  const perf = createTranslationPerformanceTracker('trace-test', 12);
  perf.add('qualityScoreMs', 10);
  perf.add('translationMs', 200);
  const payload = perf.finish();
  assert.equal(payload.traceId, 'trace-test');
  assert.equal(payload.cueCount, 12);
  assert.equal(payload.slowestStage, 'translationMs');
  assert.equal(payload.slowestStageDurationMs, 200);
  assert.ok(payload.totalPipelineMs >= 0);
});
