/**
 * ASR V2 — re-transcribe silent timeline gaps (provider missed speech).
 * Uses ffmpeg slice + Groq/OpenAI only; offsets results into gap window.
 */
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { transcribeGroq, GROQ_PROVIDER_ID } from './providers/groq-provider.js';
import { transcribeOpenAi, OPENAI_PROVIDER_ID } from './providers/openai-provider.js';
import { isFailoverEligibleError } from './errors.js';

const GAP_FILL_MIN_SEC = Number(process.env.ASR_V2_GAP_MIN_SEC || 2.5);
const GAP_FILL_MAX_SEC = Number(process.env.ASR_V2_GAP_MAX_SEC || 45);
const GAP_FILL_MAX_GAPS = Number(process.env.ASR_V2_GAP_MAX_COUNT || 4);
const GAP_FILL_ENABLED = String(process.env.ASR_V2_GAP_FILL ?? '1') !== '0';

function runFfmpeg(args, traceId) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg gap slice exit ${code}`));
    });
  });
}

export function findTimelineGaps(segments, minGapSec = GAP_FILL_MIN_SEC, maxGapSec = GAP_FILL_MAX_SEC) {
  const sorted = [...(segments || [])]
    .filter((s) => Number(s?.end) > Number(s?.start))
    .sort((a, b) => Number(a.start) - Number(b.start));
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = Number(sorted[i].end);
    const end = Number(sorted[i + 1].start);
    const dur = end - start;
    if (dur >= minGapSec && dur <= maxGapSec) {
      gaps.push({ start, end, durationSec: Number(dur.toFixed(3)), index: gaps.length });
    }
  }
  return gaps;
}

function segmentOverlapsRange(seg, rangeStart, rangeEnd) {
  const ss = Number(seg?.start);
  const se = Number(seg?.end);
  return Number.isFinite(ss) && Number.isFinite(se) && se > rangeStart + 0.15 && ss < rangeEnd - 0.15;
}

export async function extractAudioSlice(buffer, extension, startSec, durationSec, traceId) {
  const dir = await mkdtemp(join(tmpdir(), 'cutup-asr-gap-'));
  const ext = extension || 'mp3';
  const inputPath = join(dir, `input.${ext}`);
  const outputPath = join(dir, 'slice.mp3');
  try {
    await writeFile(inputPath, buffer);
    await runFfmpeg(
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(Math.max(0, startSec)),
        '-t',
        String(Math.max(0.1, durationSec)),
        '-i',
        inputPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        outputPath
      ],
      traceId
    );
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeGapSlice(ctx, sliceBuffer) {
  const invokeCtx = {
    fetch: ctx.fetch,
    audioBuffer: sliceBuffer,
    mimeType: 'audio/mpeg',
    extension: 'mp3',
    languageHint: ctx.languageHint,
    traceId: ctx.traceId
  };
  try {
    return await transcribeGroq(invokeCtx);
  } catch (groqErr) {
    if (!isFailoverEligibleError(groqErr)) throw groqErr;
    return transcribeOpenAi(invokeCtx);
  }
}

function offsetGapSegments(segments, offsetSec) {
  return (segments || []).map((s) => ({
    ...s,
    start: Number(s.start) + offsetSec,
    end: Number(s.end) + offsetSec,
    fromGapRetranscribe: true
  }));
}

/**
 * Re-transcribe timeline gaps where no segment covers the interior.
 */
export async function fillTimelineGapsWithRetranscription(ctx, segments, opts = {}) {
  if (!GAP_FILL_ENABLED) {
    return { segments: segments || [], gapRetranscribe: { enabled: false, filled: 0 } };
  }

  const base = Array.isArray(segments) ? [...segments] : [];
  const gaps = findTimelineGaps(base);
  if (!gaps.length) {
    return { segments: base, gapRetranscribe: { enabled: true, gapsFound: 0, filled: 0 } };
  }

  const inserted = [];
  const gapLog = [];
  let processed = 0;

  for (const gap of gaps) {
    if (processed >= GAP_FILL_MAX_GAPS) break;
    if (base.some((s) => segmentOverlapsRange(s, gap.start, gap.end))) continue;

    try {
      const sliceBuffer = await extractAudioSlice(
        ctx.audioBuffer,
        ctx.extension,
        gap.start,
        gap.durationSec,
        ctx.traceId
      );
      if (!sliceBuffer?.length) continue;

      const result = await transcribeGapSlice(ctx, sliceBuffer);
      const rawSegs = Array.isArray(result?.asrCapture?.rawResponse?.segments)
        ? result.asrCapture.rawResponse.segments
        : Array.isArray(result?.segments)
          ? result.segments
          : [];

      const offsetSegs = offsetGapSegments(rawSegs, gap.start).filter(
        (s) => s.text && String(s.text).trim() && s.end > s.start
      );

      if (offsetSegs.length) {
        inserted.push(...offsetSegs);
        gapLog.push({
          start: gap.start,
          end: gap.end,
          insertedCues: offsetSegs.length,
          preview: String(offsetSegs[0]?.text || '').slice(0, 80)
        });
        processed += 1;
      }
    } catch (err) {
      console.warn('[asr-v2-gap-fill]', {
        traceId: ctx.traceId,
        gap,
        message: err?.message || String(err)
      });
    }
  }

  if (!inserted.length) {
    return {
      segments: base,
      gapRetranscribe: { enabled: true, gapsFound: gaps.length, filled: 0, gaps: gapLog }
    };
  }

  const merged = [...base, ...inserted].sort((a, b) => Number(a.start) - Number(b.start));
  return {
    segments: merged,
    gapRetranscribe: {
      enabled: true,
      gapsFound: gaps.length,
      filled: inserted.length,
      gaps: gapLog
    }
  };
}
