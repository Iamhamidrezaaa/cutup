import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsrQualityReport,
  buildAsrDiagnosticsReport,
  compareAudioToRawTranscript
} from './asr-diagnostics.js';
import {
  buildAsrCapture,
  buildWhisperCompatibleRequestParams
} from './transcription/asr-provider-capture.js';

test('buildAsrQualityReport flags timeline gaps and low logprob', () => {
  const quality = buildAsrQualityReport({
    providerId: 'openai',
    audioDurationSec: 30,
    segments: [
      { start: 0, end: 2, text: 'hello world', avg_logprob: -0.2 },
      { start: 6, end: 8, text: 'missing middle speech maybe', avg_logprob: -1.4 },
      { start: 8.2, end: 10, text: 'thank you for watching', avg_logprob: -0.3 }
    ]
  });

  assert.ok(quality.missedPhraseGaps.length >= 1);
  assert.ok(quality.lowConfidenceSegments.length >= 1);
  assert.ok(quality.hallucinatedPhrases.length >= 1);
  assert.equal(quality.summary.qualityConcern, true);
});

test('compareAudioToRawTranscript reports trailing uncovered audio', () => {
  const cmp = compareAudioToRawTranscript({
    audioDurationSec: 20,
    audioBytes: 1024 * 1024,
    mimeType: 'audio/mpeg',
    extension: 'mp3',
    providerId: 'openai',
    model: 'whisper-1',
    fullText: 'one two three',
    segments: [{ start: 0, end: 4, text: 'one two three' }]
  });
  assert.equal(cmp.comparison.uncoveredTrailingSec, 16);
});

test('buildAsrDiagnosticsReport includes backend model and request params', () => {
  const capture = buildAsrCapture({
    providerId: 'openai',
    requestParams: buildWhisperCompatibleRequestParams({
      model: 'whisper-1',
      languageHint: 'en',
      providerId: 'openai'
    }),
    rawResponse: { text: 'hi', segments: [{ start: 0, end: 1, text: 'hi' }], duration: 5 },
    durationMs: 1200
  });

  const report = buildAsrDiagnosticsReport({
    traceId: 't-asr',
    route: 'transcribe',
    providerId: 'openai',
    captures: [capture],
    segments: [{ start: 0, end: 1, text: 'hi' }],
    fullText: 'hi',
    audioDurationSec: 5,
    requestParams: capture.requestParams
  });

  assert.equal(report.winner.backend, 'OpenAI Whisper API');
  assert.equal(report.winner.model, 'whisper-1');
  assert.equal(report.requestParams.wordTimestampsEnabled, true);
  assert.equal(report.requestParams.vadEnabled, false);
  assert.equal(report.captures.length, 1);
});
