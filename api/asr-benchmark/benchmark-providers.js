/**
 * Isolated ASR benchmark providers — NOT used by production transcription router.
 */
import FormDataLib from 'form-data';
import fetchModule from 'node-fetch';

const DEFAULT_TIMEOUT_MS = 180000;
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export const BENCHMARK_ENGINES = Object.freeze([
  {
    id: 'openai-whisper1',
    fileName: 'openai-whisper1.json',
    label: 'OpenAI whisper-1',
    backend: 'OpenAI Whisper API',
    model: 'whisper-1',
    vendor: 'openai'
  },
  {
    id: 'whisper-large-v3',
    fileName: 'whisper-large-v3.json',
    label: 'Whisper Large V3',
    backend: 'Groq Whisper API',
    model: 'whisper-large-v3',
    vendor: 'groq'
  },
  {
    id: 'whisper-large-v3-turbo',
    fileName: 'whisper-large-v3-turbo.json',
    label: 'Whisper Large V3 Turbo',
    backend: 'Groq Whisper API',
    model: 'whisper-large-v3-turbo',
    vendor: 'groq'
  }
]);

function getFetch(fetch) {
  return fetch || fetchModule.default || fetchModule;
}

function segmentConfidence(seg) {
  const logprob = Number(seg?.avg_logprob);
  if (Number.isFinite(logprob)) return Math.min(0.99, Math.max(0.05, 0.88 + logprob * 0.35));
  const noSpeech = Number(seg?.no_speech_prob);
  if (Number.isFinite(noSpeech)) return Math.max(0.05, 1 - noSpeech);
  return null;
}

function normalizeResult(engine, raw, durationMs) {
  const segments = Array.isArray(raw?.segments) ? raw.segments : [];
  const text = String(raw?.text || '').trim();
  const confidences = segments.map((s) => segmentConfidence(s)).filter((c) => c != null);
  const avgConfidence =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(4))
      : null;

  return {
    engineId: engine.id,
    provider: engine.label,
    backend: engine.backend,
    model: engine.model,
    vendor: engine.vendor,
    text,
    segments,
    language: raw?.language || 'unknown',
    durationSeconds: Number(raw?.duration) || (segments.length ? Math.max(...segments.map((s) => Number(s.end) || 0)) : 0),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    segmentCount: segments.length,
    avgConfidence,
    durationMs,
    rawResponse: raw
  };
}

async function callOpenAiWhisper({ fetch, audioBuffer, mimeType, extension, languageHint, model }) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }
  if (audioBuffer.length > WHISPER_MAX_BYTES) {
    return { skipped: true, reason: `audio exceeds ${WHISPER_MAX_BYTES} bytes OpenAI limit` };
  }

  const formData = new FormDataLib();
  formData.append('file', audioBuffer, {
    filename: `audio.${extension}`,
    contentType: mimeType,
    knownLength: audioBuffer.length
  });
  formData.append('model', model);
  if (languageHint) formData.append('language', languageHint);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

  const t0 = Date.now();
  const response = await getFetch(fetch)('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...formData.getHeaders()
    },
    body: formData,
    timeout: DEFAULT_TIMEOUT_MS
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI ${model} failed ${response.status}: ${errText.slice(0, 280)}`);
  }

  const json = await response.json();
  return { raw: json, durationMs: Date.now() - t0 };
}

async function callGroqWhisper({ fetch, audioBuffer, mimeType, extension, languageHint, model }) {
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey || apiKey.length < 10) {
    return { skipped: true, reason: 'GROQ_API_KEY not configured' };
  }
  if (audioBuffer.length > WHISPER_MAX_BYTES) {
    return { skipped: true, reason: `audio exceeds ${WHISPER_MAX_BYTES} bytes Groq limit` };
  }

  const formData = new FormDataLib();
  formData.append('file', audioBuffer, {
    filename: `audio.${extension}`,
    contentType: mimeType,
    knownLength: audioBuffer.length
  });
  formData.append('model', model);
  if (languageHint) formData.append('language', languageHint);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

  const t0 = Date.now();
  const response = await getFetch(fetch)('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...formData.getHeaders()
    },
    body: formData,
    timeout: DEFAULT_TIMEOUT_MS
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq ${model} failed ${response.status}: ${errText.slice(0, 280)}`);
  }

  const json = await response.json();
  return { raw: json, durationMs: Date.now() - t0 };
}

export function isBenchmarkEngineAvailable(engine) {
  if (engine.vendor === 'openai') {
    const key = process.env.OPENAI_API_KEY || '';
    return key.length >= 10;
  }
  if (engine.vendor === 'groq') {
    const key = process.env.GROQ_API_KEY || '';
    return key.length >= 10;
  }
  return false;
}

export async function transcribeBenchmarkEngine(engine, ctx) {
  const { fetch, audioBuffer, mimeType, extension, languageHint, traceId } = ctx;

  if (!isBenchmarkEngineAvailable(engine)) {
    return {
      engineId: engine.id,
      provider: engine.label,
      backend: engine.backend,
      model: engine.model,
      skipped: true,
      reason: `${engine.vendor} API key not configured`,
      text: '',
      segments: [],
      wordCount: 0,
      segmentCount: 0,
      avgConfidence: null,
      durationMs: 0,
      rawResponse: null
    };
  }

  console.log(
    JSON.stringify({
      event: 'asr_benchmark_engine_start',
      traceId,
      engineId: engine.id,
      model: engine.model,
      bytes: audioBuffer.length
    })
  );

  let callResult;
  if (engine.vendor === 'openai') {
    callResult = await callOpenAiWhisper({
      fetch,
      audioBuffer,
      mimeType,
      extension,
      languageHint,
      model: engine.model
    });
  } else if (engine.vendor === 'groq') {
    callResult = await callGroqWhisper({
      fetch,
      audioBuffer,
      mimeType,
      extension,
      languageHint,
      model: engine.model
    });
  } else {
    return {
      engineId: engine.id,
      provider: engine.label,
      skipped: true,
      reason: 'unsupported_vendor',
      segments: [],
      text: '',
      rawResponse: null
    };
  }

  if (callResult.skipped) {
    return {
      engineId: engine.id,
      provider: engine.label,
      backend: engine.backend,
      model: engine.model,
      skipped: true,
      reason: callResult.reason,
      text: '',
      segments: [],
      wordCount: 0,
      segmentCount: 0,
      avgConfidence: null,
      durationMs: 0,
      rawResponse: null
    };
  }

  const normalized = normalizeResult(engine, callResult.raw, callResult.durationMs);
  console.log(
    JSON.stringify({
      event: 'asr_benchmark_engine_done',
      traceId,
      engineId: engine.id,
      wordCount: normalized.wordCount,
      segmentCount: normalized.segmentCount,
      durationMs: normalized.durationMs
    })
  );
  return normalized;
}

export async function runAllBenchmarkEngines(ctx, opts = {}) {
  const onEngineDone = typeof opts.onEngineDone === 'function' ? opts.onEngineDone : null;
  const parallel = opts.parallel !== false;

  async function runOne(engine) {
    try {
      const result = await transcribeBenchmarkEngine(engine, ctx);
      if (onEngineDone) onEngineDone(engine, result);
      return result;
    } catch (err) {
      const failed = {
        engineId: engine.id,
        provider: engine.label,
        backend: engine.backend,
        model: engine.model,
        error: String(err?.message || err),
        skipped: false,
        failed: true,
        text: '',
        segments: [],
        wordCount: 0,
        segmentCount: 0,
        avgConfidence: null,
        rawResponse: null
      };
      if (onEngineDone) onEngineDone(engine, failed);
      return failed;
    }
  }

  if (parallel) {
    return Promise.all(BENCHMARK_ENGINES.map((engine) => runOne(engine)));
  }

  const results = [];
  for (const engine of BENCHMARK_ENGINES) {
    results.push(await runOne(engine));
  }
  return results;
}
