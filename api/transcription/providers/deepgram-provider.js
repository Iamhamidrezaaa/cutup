import { TranscriptionProviderError } from '../errors.js';
import { DEEPGRAM_PROVIDER_ID } from '../provider-ids.js';

export { DEEPGRAM_PROVIDER_ID };

function wordsToSegments(words) {
  if (!Array.isArray(words) || words.length === 0) return [];
  /** @type {{ start: number, end: number, texts: string[] }[]} */
  const buckets = [];
  let cur = {
    start: Number(words[0].start) || 0,
    end: Number(words[0].end) || 0,
    texts: [String(words[0].word || '').trim()].filter(Boolean),
    words: [{ word: String(words[0].word || '').trim(), start: Number(words[0].start) || 0, end: Number(words[0].end) || 0 }]
  };

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const start = Number(w.start) || 0;
    const end = Number(w.end) || 0;
    const gap = start - cur.end;
    const joinedLen = cur.texts.join(' ').length;
    const wordEntry = { word: String(w.word || '').trim(), start, end };

    if (gap > 1.25 || joinedLen > 220) {
      buckets.push(cur);
      cur = { start, end, texts: [wordEntry.word].filter(Boolean), words: [wordEntry] };
    } else {
      cur.end = end;
      const t = wordEntry.word;
      if (t) cur.texts.push(t);
      cur.words.push(wordEntry);
    }
  }
  buckets.push(cur);

  return buckets.map((b) => ({
    start: b.start,
    end: Math.max(b.end, b.start + 0.05),
    text: b.texts.join(' '),
    words: b.words
  }));
}

function utterancesToSegments(utterances) {
  if (!Array.isArray(utterances) || utterances.length === 0) return [];
  return utterances.map((u) => ({
    start: Number(u.start) || 0,
    end: Number(u.end) || Number(u.start) || 0,
    text: String(u.transcript || u.transcript_text || '').trim()
  }));
}

/**
 * Deepgram prerecorded transcription (nova-3).
 */
export async function transcribeDeepgram({
  fetch,
  audioBuffer,
  mimeType,
  extension,
  languageHint,
  traceId
}) {
  const apiKey = process.env.DEEPGRAM_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    const e = new Error('DEEPGRAM_API_KEY missing');
    e.name = 'AuthError';
    e.status = 401;
    throw e;
  }

  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    utterances: 'true',
    punctuate: 'true'
  });
  if (languageHint) {
    params.set('language', String(languageHint).toLowerCase().slice(0, 8));
  }

  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
  const contentType = mimeType || 'application/octet-stream';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType
    },
    body: audioBuffer,
    timeout: 180000
  });

  const rawText = await response.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = null;
  }

  if (!response.ok) {
    const msg =
      json?.err_msg ||
      json?.error ||
      json?.message ||
      rawText ||
      `Deepgram error ${response.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = response.status;
    err.traceId = traceId;
    throw err;
  }

  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const text = String(alt?.transcript || '').trim();

  let utterances =
    json?.results?.channels?.[0]?.alternatives?.[0]?.utterances ||
    json?.results?.utterances ||
    json?.utterances;

  let segments = utterancesToSegments(utterances);
  if (!segments.length && Array.isArray(alt?.words) && alt.words.length) {
    segments = wordsToSegments(alt.words);
  }

  const detected =
    json?.metadata?.detected_language ||
    alt?.languages?.[0] ||
    json?.results?.channels?.[0]?.detected_language ||
    null;

  const durationSeconds =
    segments.length > 0 ? Math.max(...segments.map((s) => Number(s.end) || 0)) : Number(json?.metadata?.duration) || 0;

  if (!text && segments.length === 0) {
    throw new TranscriptionProviderError(
      'TRANSCRIPTION_FAILED',
      'Deepgram returned no transcript',
      {
        providerId: DEEPGRAM_PROVIDER_ID,
        httpStatus: 502,
        failoverEligible: true,
        details: { traceId }
      }
    );
  }

  const joinedText =
    text ||
    segments
      .map((s) => s.text)
      .filter(Boolean)
      .join(' ')
      .trim();

  return {
    success: true,
    provider: DEEPGRAM_PROVIDER_ID,
    text: joinedText,
    segments,
    language: detected || 'unknown',
    durationSeconds
  };
}
