import FormDataLib from 'form-data';
import { classifyOpenAiTranscriptionFailure, createQuotaError } from '../../transcription-provider.js';
import { GROQ_PROVIDER_ID } from '../provider-ids.js';
import { enrichTranscriptionLanguageFields } from '../provider-language-confidence.js';
import {
  buildAsrCapture,
  buildWhisperCompatibleRequestParams
} from '../asr-provider-capture.js';

export { GROQ_PROVIDER_ID };

/**
 * Groq OpenAI-compatible audio transcription API.
 * @see https://console.groq.com/docs/speech-text
 */
export async function transcribeGroq({
  fetch,
  audioBuffer,
  mimeType,
  extension,
  languageHint,
  traceId
}) {
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    const e = new Error('GROQ_API_KEY missing');
    e.name = 'AuthError';
    e.status = 401;
    throw e;
  }

  const requestParams = buildWhisperCompatibleRequestParams({
    model: 'whisper-large-v3',
    languageHint,
    providerId: GROQ_PROVIDER_ID
  });

  const t0 = Date.now();
  const formData = new FormDataLib();
  formData.append('file', audioBuffer, {
    filename: `audio.${extension}`,
    contentType: mimeType,
    knownLength: audioBuffer.length
  });
  formData.append('model', 'whisper-large-v3');
  if (languageHint) formData.append('language', languageHint);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

  const formHeaders = formData.getHeaders();

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...formHeaders
    },
    body: formData,
    timeout: 180000
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { message: errorText };
    }
    const errorMessage =
      errorData.error?.message || errorText || `Groq API error: ${response.status} ${response.statusText}`;

    const classified = classifyOpenAiTranscriptionFailure(response.status, errorData);
    if (classified.category === 'quota') {
      throw createQuotaError(classified.rawMessage || errorMessage, classified.httpStatus, classified.openaiCode);
    }
    if (classified.category === 'rate_limit') {
      const rl = new Error(classified.rawMessage || errorMessage);
      rl.name = 'OpenAiRateLimitError';
      rl.status = response.status;
      throw rl;
    }

    if (
      response.status === 401 ||
      errorMessage.includes('Invalid API key') ||
      errorMessage.includes('invalid api key')
    ) {
      const authError = new Error(errorMessage);
      authError.name = 'AuthError';
      authError.status = 401;
      throw authError;
    }

    const err = new Error(errorMessage);
    err.status = response.status;
    err.traceId = traceId;
    throw err;
  }

  const transcript = await response.json();
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  const text = transcript.text || '';
  const language = transcript.language || 'unknown';
  const durationSeconds =
    segments.length > 0 ? Math.max(...segments.map((s) => Number(s.end) || 0)) : 0;

  const asrCapture = buildAsrCapture({
    providerId: GROQ_PROVIDER_ID,
    requestParams,
    rawResponse: transcript,
    durationMs: Date.now() - t0,
    httpStatus: 200
  });

  return enrichTranscriptionLanguageFields(
    {
      success: true,
      text,
      segments,
      language,
      durationSeconds,
      asrCapture
    },
    GROQ_PROVIDER_ID
  );
}
