/**
 * ASR comparison report builder — benchmark only, no production pipeline changes.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BENCHMARK_ENGINES } from './benchmark-providers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACE_ROOT = join(__dirname, '..', '..', 'trace');
const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\-][\p{L}\p{M}\p{N}]+)*/gu;
const GAP_THRESHOLD_SEC = 2.0;

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

function normalizeWord(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}']/gu, '');
}

function extractWords(text) {
  return (String(text || '').match(TOKEN_RE) || []).map(normalizeWord).filter(Boolean);
}

function formatClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const whole = Math.floor(ss);
  const frac = Math.round((ss - whole) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(whole)}.${String(frac).padStart(3, '0')}`;
  return `${pad(m)}:${pad(whole)}.${String(frac).padStart(3, '0')}`;
}

function formatTimestampRange(start, end) {
  return `${formatClock(start)}-${formatClock(end)}`;
}

function textForInterval(segments, start, end) {
  const parts = [];
  for (const seg of segments || []) {
    const s = Number(seg.start);
    const e = Number(seg.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (e <= start || s >= end) continue;
    const t = String(seg.text || '').trim();
    if (t) parts.push(t);
  }
  return parts.join(' ').trim();
}

function buildTimelineBoundaries(engineResults) {
  const points = new Set([0]);
  for (const r of engineResults) {
    if (r.skipped || r.failed) continue;
    for (const seg of r.segments || []) {
      const s = Number(seg.start);
      const e = Number(seg.end);
      if (Number.isFinite(s)) points.add(roundSec(s));
      if (Number.isFinite(e)) points.add(roundSec(e));
    }
  }
  return [...points].sort((a, b) => a - b);
}

function wordsMissingFrom(referenceWords, otherWords) {
  const otherSet = new Set(otherWords);
  return referenceWords.filter((w) => !otherSet.has(w));
}

export function buildTimelineDifferences(engineResults) {
  const active = engineResults.filter((r) => !r.skipped && !r.failed && (r.segments?.length || r.text));
  if (active.length < 2) return [];

  const boundaries = buildTimelineBoundaries(active);
  const differences = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end - start < 0.05) continue;

    const byEngine = {};
    const wordSets = {};
    for (const r of active) {
      const text = textForInterval(r.segments, start, end);
      byEngine[r.engineId] = text;
      wordSets[r.engineId] = extractWords(text);
    }

    const allWordLists = Object.values(wordSets);
    const union = new Set(allWordLists.flat());
    let hasDiff = false;
    for (const words of allWordLists) {
      const missing = [...union].filter((w) => !words.includes(w));
      if (missing.length > 0) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) continue;

    const row = {
      timestamp: formatTimestampRange(start, end),
      startSec: start,
      endSec: end,
      missingWordsByEngine: {}
    };

    for (const r of active) {
      const myWords = wordSets[r.engineId];
      const others = active.filter((x) => x.engineId !== r.engineId).flatMap((x) => wordSets[x.engineId]);
      const missing = wordsMissingFrom(myWords, others);
      if (missing.length) row.missingWordsByEngine[r.engineId] = missing;
    }

    for (const engine of BENCHMARK_ENGINES) {
      row[engine.id] = byEngine[engine.id] || '';
    }
    row.providerA = row['openai-whisper1'] || '';
    row.providerB = row['whisper-large-v3'] || '';
    row.providerC = row['whisper-large-v3-turbo'] || '';

    differences.push(row);
  }

  return differences;
}

function findMissingPhraseGaps(segments, audioDurationSec) {
  const sorted = [...(segments || [])].sort((a, b) => Number(a.start) - Number(b.start));
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = roundSec(sorted[i].end);
    const gapEnd = roundSec(sorted[i + 1].start);
    const gapSec = gapEnd - gapStart;
    if (gapSec >= GAP_THRESHOLD_SEC) {
      gaps.push({
        type: 'timeline_gap',
        gapStart,
        gapEnd,
        gapSec: roundSec(gapSec),
        reason: 'no_transcript_in_gap'
      });
    }
  }
  if (Number.isFinite(audioDurationSec) && sorted.length) {
    const tail = roundSec(audioDurationSec - sorted[sorted.length - 1].end);
    if (tail >= GAP_THRESHOLD_SEC) {
      gaps.push({
        type: 'trailing_uncovered',
        gapStart: roundSec(sorted[sorted.length - 1].end),
        gapEnd: roundSec(audioDurationSec),
        gapSec: tail
      });
    }
  }
  return gaps;
}

export function buildProviderSummary(result, audioDurationSec) {
  const segments = result.segments || [];
  const durations = segments
    .map((s) => Math.max(0, Number(s.end) - Number(s.start)))
    .filter((d) => d > 0);
  const coverageEnd = segments.length
    ? Math.max(...segments.map((s) => Number(s.end) || 0))
    : 0;

  return {
    provider: result.provider,
    engineId: result.engineId,
    model: result.model,
    backend: result.backend,
    skipped: Boolean(result.skipped),
    failed: Boolean(result.failed),
    error: result.error || result.reason || null,
    wordCount: result.wordCount ?? extractWords(result.text).length,
    segmentCount: result.segmentCount ?? segments.length,
    avgConfidence: result.avgConfidence ?? null,
    avgSegmentDurationSec:
      durations.length > 0
        ? roundSec(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
    transcriptCoverageRatio:
      audioDurationSec > 0 ? roundSec(coverageEnd / audioDurationSec) : null,
    missingPhraseCandidates: findMissingPhraseGaps(segments, audioDurationSec)
  };
}

export function buildComparisonReport({ audioDurationSec, engineResults }) {
  const providers = engineResults.map((r) => buildProviderSummary(r, audioDurationSec));
  const differences = buildTimelineDifferences(engineResults);

  const globalWordSets = {};
  for (const r of engineResults) {
    if (r.skipped || r.failed) continue;
    globalWordSets[r.engineId] = new Set(extractWords(r.text));
  }

  const wordLossFlags = [];
  const engineIds = Object.keys(globalWordSets);
  for (const id of engineIds) {
    const mine = globalWordSets[id];
    const others = new Set();
    for (const oid of engineIds) {
      if (oid === id) continue;
      for (const w of globalWordSets[oid]) others.add(w);
    }
    const onlyHere = [...mine].filter((w) => !others.has(w));
    const missingHere = [...others].filter((w) => !mine.has(w));
    if (onlyHere.length || missingHere.length) {
      wordLossFlags.push({
        engineId: id,
        wordsOnlyInThisEngine: onlyHere.slice(0, 80),
        wordsMissingFromThisEngine: missingHere.slice(0, 80)
      });
    }
  }

  return {
    audioDuration: audioDurationSec ?? null,
    providers,
    differences,
    wordLossFlags,
    generatedAt: new Date().toISOString()
  };
}

export function buildComparisonSummaryText(report, engineResults) {
  const lines = [];
  lines.push('ASR Comparison Summary');
  lines.push('='.repeat(60));
  lines.push(`Audio duration: ${report.audioDuration ?? 'unknown'} sec`);
  lines.push('');

  for (const p of report.providers) {
    lines.push(`${p.provider} (${p.model || 'n/a'})`);
    lines.push(
      `  words=${p.wordCount} segments=${p.segmentCount} avgConfidence=${p.avgConfidence ?? 'n/a'} coverage=${p.transcriptCoverageRatio ?? 'n/a'}`
    );
    if (p.skipped) lines.push(`  SKIPPED: ${p.error}`);
    if (p.failed) lines.push(`  FAILED: ${p.error}`);
    if (p.missingPhraseCandidates?.length) {
      lines.push(`  missing phrase gap candidates: ${p.missingPhraseCandidates.length}`);
    }
    lines.push('');
  }

  if (report.wordLossFlags?.length) {
    lines.push('Global word differences');
    lines.push('-'.repeat(40));
    for (const flag of report.wordLossFlags) {
      const engine = BENCHMARK_ENGINES.find((e) => e.id === flag.engineId);
      lines.push(engine?.label || flag.engineId);
      if (flag.wordsMissingFromThisEngine?.length) {
        lines.push(`  missing vs others: ${flag.wordsMissingFromThisEngine.join(', ')}`);
      }
      if (flag.wordsOnlyInThisEngine?.length) {
        lines.push(`  only in this engine: ${flag.wordsOnlyInThisEngine.join(', ')}`);
      }
      lines.push('');
    }
  }

  if (report.differences?.length) {
    lines.push('Timeline differences');
    lines.push('-'.repeat(40));
    for (const diff of report.differences) {
      lines.push(`Timestamp ${diff.timestamp}`);
      lines.push('');
      for (const engine of BENCHMARK_ENGINES) {
        const text = diff[engine.id] || '(no text)';
        lines.push(`${engine.label}:`);
        lines.push(`"${text}"`);
        const missing = diff.missingWordsByEngine?.[engine.id];
        if (missing?.length) {
          lines.push(`  [words missing vs other engines: ${missing.join(', ')}]`);
        }
        lines.push('');
      }
      lines.push('');
    }
  } else {
    lines.push('No timeline differences detected between active engines.');
  }

  return lines.join('\n');
}

export function resolveAsrComparisonDir(traceId) {
  const id = String(traceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return join(TRACE_ROOT, id, 'asr-comparison');
}

export function saveAsrComparisonArtifacts({ traceId, engineResults, report, summaryText }) {
  const dir = resolveAsrComparisonDir(traceId);
  mkdirSync(dir, { recursive: true });

  const written = [];
  for (const engine of BENCHMARK_ENGINES) {
    const result = engineResults.find((r) => r.engineId === engine.id);
    const path = join(dir, engine.fileName);
    const payload = result?.rawResponse
      ? result.rawResponse
      : {
          skipped: result?.skipped || false,
          failed: result?.failed || false,
          error: result?.error || result?.reason || null,
          text: result?.text || '',
          segments: result?.segments || []
        };
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
    written.push(path);
  }

  const reportPath = join(dir, 'comparison-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  written.push(reportPath);

  const summaryPath = join(dir, 'comparison-summary.txt');
  writeFileSync(summaryPath, summaryText, 'utf8');
  written.push(summaryPath);

  return { dir, written };
}
