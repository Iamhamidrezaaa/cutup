import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranscriptionRuntime,
  audioDurationFromSegments,
  resolveTranscriptionModel
} from './transcription-runtime.js';

test('buildTranscriptionRuntime maps groq provider and model', () => {
  const rt = buildTranscriptionRuntime({
    providerId: 'groq',
    transcriptionDurationMs: 4200,
    audioDurationSec: 125.5
  });
  assert.equal(rt.provider, 'groq');
  assert.equal(rt.providerLabel, 'Groq');
  assert.equal(rt.model, 'whisper-large-v3');
  assert.equal(rt.transcriptionDurationMs, 4200);
  assert.equal(rt.audioDurationSec, 125.5);
});

test('audioDurationFromSegments uses last segment end', () => {
  assert.equal(
    audioDurationFromSegments([
      { start: 0, end: 2 },
      { start: 2, end: 9.25 }
    ]),
    9.25
  );
});

test('resolveTranscriptionModel for openai fallback', () => {
  assert.equal(resolveTranscriptionModel('openai'), 'whisper-1');
});
