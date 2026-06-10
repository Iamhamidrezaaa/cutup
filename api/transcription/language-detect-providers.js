/**
 * Lightweight language-only detection passes (verification mode).
 */
import FormDataLib from 'form-data';
import { OPENAI_PROVIDER_ID } from './provider-ids.js';
import { GROQ_PROVIDER_ID } from './provider-ids.js';
import { DEEPGRAM_PROVIDER_ID } from './provider-ids.js';
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
  formData.append('model', providerId === GROQ_PROVIDER_ID ? 'whisper-large-v3' : 'whisper-1');
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

export async function detectLanguageGroq(ctx) {
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    throw new Error('GROQ_API_KEY missing');
  }
  return whisperDetectLanguage({
    ...ctx,
    apiUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
    apiKey,
    providerId: GROQ_PROVIDER_ID
  });
}

export async function detectLanguageDeepgram(ctx) {
  const apiKey = process.env.DEEPGRAM_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    throw new Error('DEEPGRAM_API_KEY missing');
  }

  const params = new URLSearchParams({
    model: 'nova-3',
    detect_language: 'true',
    punctuate: 'false',
    smart_format: 'false'
  });

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': ctx.mimeType || 'audio/mpeg'
    },
    body: ctx.audioBuffer,
    timeout: 90000
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`deepgram language detect failed: ${response.status} ${raw.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('deepgram language detect invalid JSON');
  }

  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const language =
    normalizeLanguageCode(
      json?.metadata?.detected_language ||
        alt?.languages?.[0] ||
        json?.results?.channels?.[0]?.detected_language
    ) || 'unknown';
  const confidence = estimateDeepgramLanguageConfidence(alt?.confidence, language);
  return { provider: DEEPGRAM_PROVIDER_ID, language, confidence, traceId: ctx.traceId };
}

/**
 * Parallel verification on a short audio sample.
 * @param {object} ctx
 * @param {typeof fetch} ctx.fetch
 * @param {Buffer} ctx.audioBuffer
 * @param {string} ctx.mimeType
 * @param {string} ctx.extension
 * @param {string} [ctx.traceId]
 */
export async function detectLanguageParallelVerification(ctx) {
  const detectors = [
    { id: OPENAI_PROVIDER_ID, fn: detectLanguageOpenAi, env: 'OPENAI_API_KEY' },
    { id: GROQ_PROVIDER_ID, fn: detectLanguageGroq, env: 'GROQ_API_KEY' },
    { id: DEEPGRAM_PROVIDER_ID, fn: detectLanguageDeepgram, env: 'DEEPGRAM_API_KEY' }
  ];

  const available = detectors.filter((d) => {
    const key = process.env[d.env] || '';
    return key.length >= 10;
  });

  const settled = await Promise.allSettled(
    available.map((d) =>
      d.fn({
        fetch: ctx.fetch,
        audioBuffer: ctx.audioBuffer,
        mimeType: ctx.mimeType,
        extension: ctx.extension,
        traceId: ctx.traceId
      })
    )
  );

  const votes = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled' && s.value?.language) {
      votes.push(s.value);
    }
  }
  return votes;
}
