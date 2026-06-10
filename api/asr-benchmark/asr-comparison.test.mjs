import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComparisonReport,
  buildComparisonSummaryText,
  buildTimelineDifferences
} from './asr-comparison.js';

const engineA = {
  engineId: 'openai-whisper1',
  provider: 'OpenAI whisper-1',
  model: 'whisper-1',
  skipped: false,
  text: 'Sorry I just wanna challenge you',
  segments: [{ start: 11, end: 14, text: 'Sorry I just wanna challenge you', avg_logprob: -0.2 }],
  wordCount: 6,
  segmentCount: 1,
  avgConfidence: 0.82
};

const engineB = {
  engineId: 'whisper-large-v3',
  provider: 'Whisper Large V3',
  model: 'whisper-large-v3',
  skipped: false,
  text: 'Sorry I just wanna challenge you. You wanna challenge me?',
  segments: [
    { start: 11, end: 13.5, text: 'Sorry I just wanna challenge you.', avg_logprob: -0.15 },
    { start: 13.5, end: 14.5, text: 'You wanna challenge me?', avg_logprob: -0.18 }
  ],
  wordCount: 11,
  segmentCount: 2,
  avgConfidence: 0.86
};

test('buildTimelineDifferences flags extra words in one engine', () => {
  const diffs = buildTimelineDifferences([engineA, engineB]);
  assert.ok(diffs.length >= 1);
  const hasExtra = diffs.some(
    (d) =>
      String(d['whisper-large-v3'] || '').includes('challenge me') &&
      String(d['openai-whisper1'] || '').length > 0
  );
  assert.equal(hasExtra, true);
});

test('buildComparisonReport includes providers and word loss flags', () => {
  const report = buildComparisonReport({
    audioDurationSec: 20,
    engineResults: [engineA, engineB]
  });
  assert.equal(report.providers.length, 2);
  assert.ok(report.differences.length >= 1);
  assert.ok(report.wordLossFlags.length >= 1);
  const whisper1Flag = report.wordLossFlags.find((f) => f.engineId === 'openai-whisper1');
  assert.ok(whisper1Flag?.wordsMissingFromThisEngine?.includes('me'));
});

test('buildComparisonSummaryText is human readable', () => {
  const report = buildComparisonReport({
    audioDurationSec: 20,
    engineResults: [engineA, engineB]
  });
  const text = buildComparisonSummaryText(report, [engineA, engineB]);
  assert.ok(text.includes('OpenAI whisper-1'));
  assert.ok(text.includes('Whisper Large V3'));
  assert.ok(text.includes('Timestamp'));
});
