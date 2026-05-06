import FormDataLib from 'form-data';
import { classifyOpenAiTranscriptionFailure, createQuotaError } from '../../transcription-provider.js';
import { OPENAI_PROVIDER_ID } from '../provider-ids.js';

export { OPENAI_PROVIDER_ID };

/**
 * @param {object} opts
 * @param {typeof fetch} opts.fetch
 * @param {Buffer} opts.audioBuffer
 * @param {string} opts.mimeType
 * @param {string} opts.extension
 * @param {string|null} opts.languageHint
 * @param {string} opts.traceId
 */
export async function transcribeOpenAi({
  fetch,
  audioBuffer,
  mimeType,
  extension,
  languageHint,
  traceId
}) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    const e = new Error('OPENAI_API_KEY missing');
    e.name = 'AuthError';
    e.status = 401;
    throw e;
  }

  const formData = new FormDataLib();
  formData.append('file', audioBuffer, {
    filename: `audio.${extension}`,
    contentType: mimeType,
    knownLength: audioBuffer.length
  });
  formData.append('model', 'whisper-1');
  if (languageHint) formData.append('language', languageHint);
  formData.append('response_format', 'verbose_json');

  const formHeaders = formData.getHeaders();

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
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
      errorData.error?.message || errorText || `OpenAI API error: ${response.status} ${response.statusText}`;

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

    if (response.status === 429 && /quota|billing|insufficient/i.test(errorMessage)) {
      throw createQuotaError(errorMessage, response.status, errorData.error?.code);
    }

    if (
      response.status === 401 ||
      errorMessage.includes('Invalid API key') ||
      errorMessage.includes('Incorrect API key')
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

  return {
    success: true,
    provider: OPENAI_PROVIDER_ID,
    text,
    segments,
    language,
    durationSeconds
  };
}
