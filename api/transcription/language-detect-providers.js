/**
 * OpenAI-first language detection (no Groq/Deepgram required).
 */
import FormDataLib from 'form-data';
import { OPENAI_PROVIDER_ID } from './provider-ids.js';
import {
  estimateDeepgramLanguageConfidence,
  estimateWhisperLanguageConfidence
} from './provider-language-confidence.js';
import { normalizeLanguageCode } from '../supported-languages.js';

async function whisperDetectLanguage({ fetch, audioBuffer, mimeType, extension, apiUrl, apiKey, providerId, traceId }) {
  const formData = new FormDataLib();
  formData.append('file', audioBuffer, {
    filename: `lang-sample.${extension || 'mp3'}`,
    contentType: mimeType || 'audio/mpeg',
    knownLength: audioBuffer.length
  });
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...formData.getHeaders()
    },
    body: formData,
    timeout: 90000
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`${providerId} language detect failed: ${response.status} ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const language = normalizeLanguageCode(json.language) || 'unknown';
  const confidence = estimateWhisperLanguageConfidence(json.segments, language);
  return { provider: providerId, language, confidence, traceId };
}

export function isOpenAiLanguageDetectionAvailable() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  return apiKey.length >= 10;
}

export async function detectLanguageOpenAi(ctx) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    throw new Error('OPENAI_API_KEY missing');
  }
  return whisperDetectLanguage({
    ...ctx,
    apiUrl: 'https://api.openai.com/v1/audio/transcriptions',
    apiKey,
    providerId: OPENAI_PROVIDER_ID
  });
}

/**
 * Run OpenAI Whisper language detection on first / middle / last audio samples.
 * @param {object} ctx
 * @param {typeof fetch} ctx.fetch
 * @param {Array<{ position: string, buffer: Buffer, mimeType: string, extension: string }>} ctx.samples
 * @param {string} [ctx.traceId]
 */
export async function detectLanguageOpenAiTripleSample(ctx) {
  if (!isOpenAiLanguageDetectionAvailable()) {
    return [];
  }

  const samples = Array.isArray(ctx.samples) ? ctx.samples : [];
  const votes = [];

  for (const sample of samples) {
    if (!sample?.buffer?.length) continue;
    try {
      const result = await detectLanguageOpenAi({
        fetch: ctx.fetch,
        audioBuffer: sample.buffer,
        mimeType: sample.mimeType || 'audio/mpeg',
        extension: sample.extension || 'mp3',
        traceId: ctx.traceId
      });
      votes.push({
        ...result,
        position: sample.position || null,
        startSec: sample.startSec ?? null
      });
    } catch (err) {
      console.warn('[language_detect_sample_failed]', {
        traceId: ctx.traceId || null,
        position: sample.position || null,
        message: err?.message || String(err)
      });
    }
  }

  return votes;
}

/**
 * @deprecated Use detectLanguageOpenAiTripleSample — only OpenAI is required in production.
 * Kept for backward compatibility; runs triple-sample when only OpenAI is configured.
 */
export async function detectLanguageParallelVerification(ctx) {
  const { sliceAudioVerificationSamples } = await import('./audio-language-sample.js');
  const samples = await sliceAudioVerificationSamples(
    ctx.audioBuffer,
    ctx.mimeType,
    ctx.extension,
    15
  );
  return detectLanguageOpenAiTripleSample({
    fetch: ctx.fetch,
    samples,
    traceId: ctx.traceId
  });
}
