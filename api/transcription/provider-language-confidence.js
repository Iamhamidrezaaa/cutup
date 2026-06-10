/**
 * Estimate provider-reported language confidence from Whisper / ASR payloads.
 */

import { normalizeLanguageCode } from '../supported-languages.js';

/**
 * @param {{ avg_logprob?: number, no_speech_prob?: number }[]} [segments]
 * @param {string} language
 * @returns {number} 0.0–1.0
 */
export function estimateWhisperLanguageConfidence(segments, language) {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === 'unknown') return 0.45;

  const segs = Array.isArray(segments) ? segments : [];
  const logprobs = segs.map((s) => Number(s?.avg_logprob)).filter(Number.isFinite);
  const noSpeech = segs.map((s) => Number(s?.no_speech_prob)).filter(Number.isFinite);

  let conf = 0.72;
  if (logprobs.length) {
    const avg = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
    conf = Math.min(0.99, Math.max(0.42, 0.88 + avg * 0.35));
  }
  if (noSpeech.length) {
    const avgNs = noSpeech.reduce((a, b) => a + b, 0) / noSpeech.length;
    conf = Math.min(conf, Math.max(0.4, 1 - avgNs * 1.2));
  }
  return Number(conf.toFixed(4));
}

/**
 * @param {number|null|undefined} deepgramConfidence
 * @param {string} language
 */
export function estimateDeepgramLanguageConfidence(deepgramConfidence, language) {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === 'unknown') return 0.5;
  if (Number.isFinite(Number(deepgramConfidence))) {
    return Number(Math.min(0.99, Math.max(0.4, Number(deepgramConfidence))).toFixed(4));
  }
  return 0.8;
}

/**
 * Attach normalized language + confidence to a provider transcription result.
 * @param {object} result
 * @param {string} providerId
 */
export function enrichTranscriptionLanguageFields(result, providerId) {
  const language = normalizeLanguageCode(result?.language) || 'unknown';
  let languageConfidence = Number(result?.languageConfidence);
  if (!Number.isFinite(languageConfidence)) {
    if (providerId === 'deepgram') {
      languageConfidence = estimateDeepgramLanguageConfidence(result?.deepgramConfidence, language);
    } else {
      languageConfidence = estimateWhisperLanguageConfidence(result?.segments, language);
    }
  }
  return {
    ...result,
    provider: providerId,
    language,
    languageConfidence,
    confidence: languageConfidence
  };
}
