import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAsrPipelineVersion,
  isAsrPipelineV2,
  preserveProviderOutput,
  segmentsToCleanSrt,
  formatRawAsrDebugPayload,
  reconcileSegmentsWithProviderWords,
  findUncoveredProviderWords
} from './transcription-v2.js';
import { buildV1V2ComparisonReport } from './asr-pipeline-comparison.js';

test('ASR_PIPELINE defaults to v2', () => {
  const prev = process.env.ASR_PIPELINE;
  delete process.env.ASR_PIPELINE;
  assert.equal(getAsrPipelineVersion(), 'v2');
  assert.equal(isAsrPipelineV2(), true);
  if (prev !== undefined) process.env.ASR_PIPELINE = prev;
});

test('ASR_PIPELINE=v1 selects legacy path', () => {
  const prev = process.env.ASR_PIPELINE;
  process.env.ASR_PIPELINE = 'v1';
  assert.equal(getAsrPipelineVersion(), 'v1');
  assert.equal(isAsrPipelineV2(), false);
  if (prev !== undefined) process.env.ASR_PIPELINE = prev;
  else delete process.env.ASR_PIPELINE;
});

test('preserveProviderOutput keeps segments and words unchanged', () => {
  const raw = {
    text: 'hello world',
    language: 'en',
    segments: [{ id: 0, start: 0, end: 1.2, text: 'hello world', words: [{ word: 'hello', start: 0, end: 0.5 }] }],
    words: [{ word: 'hello', start: 0, end: 0.5 }]
  };
  const out = preserveProviderOutput({ asrCapture: { rawResponse: raw } }, 'groq');
  assert.equal(out.text, 'hello world');
  assert.equal(out.segments.length, 1);
  assert.equal(out.segments[0].text, 'hello world');
  assert.equal(out.segments[0].start, 0);
  assert.equal(out.words.length, 1);
  assert.equal(out.model, 'whisper-large-v3');
});

test('segmentsToCleanSrt is format-only', () => {
  const srt = segmentsToCleanSrt([{ start: 1.5, end: 3.25, text: 'Hi there' }]);
  assert.match(srt, /^1\n/);
  assert.match(srt, /00:00:01,500 --> 00:00:03,250/);
  assert.match(srt, /Hi there/);
});

test('formatRawAsrDebugPayload returns first 50 segments', () => {
  const payload = formatRawAsrDebugPayload({
    provider: 'groq',
    model: 'whisper-large-v3',
    language: 'en',
    segments: [{ start: 0, end: 1, text: 'a' }]
  });
  assert.equal(payload.segment_count, 1);
  assert.equal(payload.first_50_segments[0].text, 'a');
});

test('reconcileSegmentsWithProviderWords fills segment gap from provider words', () => {
  const segments = [
    { start: 8.88, end: 11.547, text: 'Sorry I just wanna challenge' },
    { start: 11.547, end: 12.08, text: 'you' },
    { start: 18.679, end: 20.679, text: 'I mean challenge deadlifting' }
  ];
  const words = [
    { word: 'what', start: 12.4, end: 12.7 },
    { word: 'kidding', start: 12.75, end: 13.1 },
    { word: 'challenge', start: 13.2, end: 13.6 },
    { word: 'with', start: 13.65, end: 13.8 },
    { word: 'you', start: 13.85, end: 14.0 },
    { word: 'guys', start: 14.05, end: 14.4 }
  ];
  const uncovered = findUncoveredProviderWords(segments, words);
  assert.equal(uncovered.length, 6);
  const { segments: out, wordGapFill } = reconcileSegmentsWithProviderWords(segments, words);
  assert.equal(wordGapFill.inserted, 1);
  assert.equal(out.length, 4);
  assert.ok(out.some((s) => s.text.includes('kidding')));
  assert.ok(out.some((s) => s.text.includes('deadlifting')));
});

test('buildV1V2ComparisonReport detects timing and segment loss', () => {
  const report = buildV1V2ComparisonReport(
    {
      text: 'one two',
      segments: [
        { start: 0.5, end: 2, text: 'one' },
        { start: 2, end: 4, text: 'two' }
      ]
    },
    {
      text: 'one two three',
      segments: [
        { start: 0, end: 1.5, text: 'one' },
        { start: 1.5, end: 3, text: 'two' },
        { start: 3, end: 4.5, text: 'three' }
      ]
    }
  );
  assert.equal(report.v2SegmentCount, 3);
  assert.equal(report.v1SegmentCount, 2);
  assert.equal(report.missingSegmentCount, 1);
  assert.ok(report.timingModificationCount >= 1);
});
