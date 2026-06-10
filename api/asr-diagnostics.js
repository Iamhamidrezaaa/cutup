/**
 * ASR diagnostics — speech recognition accuracy reporting only.
 * Does not modify transcription output or subtitle pipelines.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { resolveBackendLabel } from './transcription/asr-provider-capture.js';

const GAP_MISS_THRESHOLD_SEC = 2.0;
const LOW_LOGPROB_THRESHOLD = -0.85;
const HIGH_NO_SPEECH_THRESHOLD = 0.55;
const HALLUCINATION_PATTERNS = [
  /thank you for watching/i,
  /thanks for watching/i,
  /please subscribe/i,
  /subtitles by/i,
  /amara\.org/i,
  /^\[music\]$/i,
  /^\[applause\]$/i
];

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

function segmentConfidence(seg) {
  const logprob = Number(seg?.avg_logprob);
  const noSpeech = Number(seg?.no_speech_prob);
  if (Number.isFinite(logprob)) {
    return Math.min(0.99, Math.max(0.05, 0.88 + logprob * 0.35));
  }
  if (Number.isFinite(noSpeech)) {
    return Math.max(0.05, 1 - noSpeech);
  }
  return null;
}

function isHallucinationText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return HALLUCINATION_PATTERNS.some((re) => re.test(t));
}

function estimateAudioDurationSec(opts = {}) {
  const {
    audioBuffer,
    mimeType,
    extension,
    providerDurationSec,
    segmentMaxEnd,
    audioBytes
  } = opts;

  if (Number.isFinite(providerDurationSec) && providerDurationSec > 0) {
    return providerDurationSec;
  }
  if (Number.isFinite(segmentMaxEnd) && segmentMaxEnd > 0) {
    return segmentMaxEnd;
  }
  const bytes = audioBuffer?.length || audioBytes || 0;
  if (bytes > 0 && String(mimeType || '').includes('mpeg')) {
    return roundSec((bytes / (128 * 1024 / 8)));
  }
  const ext = String(extension || '').toLowerCase();
  if (bytes > 0 && (ext === 'mp3' || ext === 'mpeg')) {
    return roundSec(bytes / (128 * 1024 / 8));
  }
  return null;
}

async function probeAudioDurationWithFfprobe(audioBuffer, extension = 'mp3') {
  if (!audioBuffer?.length) return null;
  const dir = await mkdtemp(join(tmpdir(), 'cutup-asr-probe-'));
  const inputPath = join(dir, `audio.${extension || 'mp3'}`);
  try {
    await writeFile(inputPath, audioBuffer);
    const sec = await new Promise((resolve) => {
      const proc = spawn(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inputPath
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let out = '';
      proc.stdout.on('data', (d) => {
        out += d.toString();
      });
      proc.on('error', () => resolve(null));
      proc.on('close', () => {
        const n = parseFloat(String(out).trim());
        resolve(Number.isFinite(n) && n > 0 ? roundSec(n) : null);
      });
    });
    return sec;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Heuristic ASR quality analysis on raw provider segments.
 */
export function buildAsrQualityReport(opts = {}) {
  const segments = Array.isArray(opts.segments) ? opts.segments : [];
  const audioDurationSec = opts.audioDurationSec ?? null;
  const providerId = opts.providerId || null;

  const lowConfidenceSegments = [];
  const hallucinatedPhrases = [];
  const suspiciousSegments = [];
  const missedPhraseGaps = [];

  const sorted = [...segments]
    .filter((s) => s && Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)))
    .sort((a, b) => Number(a.start) - Number(b.start));

  let transcriptCoverageEnd = 0;
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const start = roundSec(seg.start);
    const end = roundSec(seg.end);
    const text = String(seg.text || '').trim();
    const conf = segmentConfidence(seg);
    const logprob = Number(seg.avg_logprob);
    const noSpeech = Number(seg.no_speech_prob);
    const dur = Math.max(0, end - start);
    transcriptCoverageEnd = Math.max(transcriptCoverageEnd, end);

    const base = {
      segmentIndex: i,
      start,
      end,
      durationSec: roundSec(dur),
      text: text.slice(0, 200),
      avgLogprob: Number.isFinite(logprob) ? roundSec(logprob) : null,
      noSpeechProb: Number.isFinite(noSpeech) ? roundSec(noSpeech) : null,
      confidence: conf != null ? roundSec(conf) : null
    };

    if (Number.isFinite(logprob) && logprob <= LOW_LOGPROB_THRESHOLD) {
      lowConfidenceSegments.push({ ...base, reason: 'low_avg_logprob' });
    } else if (conf != null && conf < 0.45) {
      lowConfidenceSegments.push({ ...base, reason: 'low_derived_confidence' });
    } else if (Number.isFinite(noSpeech) && noSpeech >= HIGH_NO_SPEECH_THRESHOLD && text) {
      lowConfidenceSegments.push({ ...base, reason: 'high_no_speech_prob_with_text' });
    }

    if (isHallucinationText(text)) {
      hallucinatedPhrases.push({ ...base, reason: 'known_hallucination_pattern' });
    } else if (Number.isFinite(logprob) && logprob < -1.2 && text.length > 12) {
      hallucinatedPhrases.push({ ...base, reason: 'very_low_logprob_long_text' });
    }

    if (dur > 0 && dur < 0.12 && text.split(/\s+/).length > 3) {
      suspiciousSegments.push({ ...base, reason: 'dense_text_short_duration' });
    }
    if (Number.isFinite(seg.compression_ratio) && (seg.compression_ratio > 2.8 || seg.compression_ratio < 0.5)) {
      suspiciousSegments.push({ ...base, reason: 'unusual_compression_ratio', compressionRatio: seg.compression_ratio });
    }
    if (text && text.length <= 2 && dur > 1.5) {
      suspiciousSegments.push({ ...base, reason: 'long_duration_tiny_text' });
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      const gapStart = roundSec(prev.end);
      const gapEnd = start;
      const gapSec = gapEnd - gapStart;
      if (gapSec >= GAP_MISS_THRESHOLD_SEC) {
        missedPhraseGaps.push({
          type: 'timeline_gap',
          gapStart,
          gapEnd,
          gapSec: roundSec(gapSec),
          beforeSegmentIndex: i - 1,
          afterSegmentIndex: i,
          beforeText: String(prev.text || '').slice(0, 120),
          afterText: text.slice(0, 120),
          reason: 'no_transcript_during_audible_gap_heuristic'
        });
      }
    }
  }

  if (Number.isFinite(audioDurationSec) && audioDurationSec > 0) {
    const headGap = sorted.length ? roundSec(sorted[0].start) : audioDurationSec;
    if (headGap >= GAP_MISS_THRESHOLD_SEC) {
      missedPhraseGaps.push({
        type: 'leading_audio_uncovered',
        gapStart: 0,
        gapEnd: headGap,
        gapSec: headGap,
        reason: 'speech_may_exist_before_first_segment'
      });
    }
    const tailGap = roundSec(audioDurationSec - transcriptCoverageEnd);
    if (tailGap >= GAP_MISS_THRESHOLD_SEC) {
      missedPhraseGaps.push({
        type: 'trailing_audio_uncovered',
        gapStart: transcriptCoverageEnd,
        gapEnd: roundSec(audioDurationSec),
        gapSec: tailGap,
        reason: 'speech_may_exist_after_last_segment'
      });
    }
    const coverageRatio =
      audioDurationSec > 0 ? roundSec(transcriptCoverageEnd / audioDurationSec) : null;
    if (coverageRatio != null && coverageRatio < 0.55 && segments.length > 0) {
      missedPhraseGaps.push({
        type: 'low_timeline_coverage',
        audioDurationSec,
        transcriptCoverageEnd,
        coverageRatio,
        reason: 'transcript_covers_minority_of_audio_duration'
      });
    }
  }

  return {
    providerId,
    segmentCount: sorted.length,
    audioDurationSec,
    transcriptCoverageEnd: roundSec(transcriptCoverageEnd),
    lowConfidenceSegments,
    hallucinatedPhrases,
    missedPhraseGaps,
    suspiciousSegments,
    summary: {
      lowConfidenceCount: lowConfidenceSegments.length,
      hallucinationCount: hallucinatedPhrases.length,
      missedGapCount: missedPhraseGaps.length,
      suspiciousCount: suspiciousSegments.length,
      qualityConcern:
        lowConfidenceSegments.length > 0 ||
        hallucinatedPhrases.length > 0 ||
        missedPhraseGaps.length > 0 ||
        suspiciousSegments.length > 0
    }
  };
}

export function compareAudioToRawTranscript(opts = {}) {
  const {
    audioDurationSec,
    audioBytes,
    mimeType,
    extension,
    segments = [],
    fullText = '',
    providerId,
    model
  } = opts;

  const sorted = [...segments].sort((a, b) => Number(a.start) - Number(b.start));
  const firstStart = sorted[0] ? roundSec(sorted[0].start) : null;
  const lastEnd = sorted.length ? roundSec(sorted[sorted.length - 1].end) : null;
  const wordCount = String(fullText || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    audio: {
      durationSec: audioDurationSec ?? null,
      bytes: audioBytes ?? null,
      mimeType: mimeType || null,
      extension: extension || null
    },
    transcript: {
      providerId: providerId || null,
      backend: providerId ? resolveBackendLabel(providerId) : null,
      model: model || null,
      segmentCount: sorted.length,
      wordCount,
      charCount: String(fullText || '').length,
      firstSegmentStart: firstStart,
      lastSegmentEnd: lastEnd,
      timelineSpanSec:
        firstStart != null && lastEnd != null ? roundSec(lastEnd - firstStart) : null
    },
    comparison: {
      audioVsTranscriptEndDeltaSec:
        audioDurationSec != null && lastEnd != null ? roundSec(audioDurationSec - lastEnd) : null,
      uncoveredLeadingSec: firstStart,
      uncoveredTrailingSec:
        audioDurationSec != null && lastEnd != null ? roundSec(Math.max(0, audioDurationSec - lastEnd)) : null,
      wordsPerMinute:
        audioDurationSec > 0 ? roundSec((wordCount / audioDurationSec) * 60) : null
    }
  };
}

export function resolveAsrDiagnosticsDir(traceId) {
  const id = String(traceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return join(tmpdir(), 'cutup-asr-diagnostics', id);
}

export function buildAsrDiagnosticsReport(opts = {}) {
  const {
    traceId,
    route = null,
    transcriptFromCache = false,
    providerId,
    model,
    backend,
    engineFamily,
    requestParams,
    routerMeta,
    captures = [],
    chunkDiagnostics = [],
    segments = [],
    fullText = '',
    audioBuffer = null,
    mimeType = null,
    extension = null,
    languageHint = null,
    hintResolution = null,
    preTranscription = null,
    accentRetranscribe = null,
    audioDurationSec = null
  } = opts;

  const primaryCapture = captures[captures.length - 1] || null;
  const quality = buildAsrQualityReport({
    segments,
    audioDurationSec,
    providerId: providerId || primaryCapture?.providerId
  });

  const audioComparison = compareAudioToRawTranscript({
    audioDurationSec,
    audioBytes: audioBuffer?.length ?? null,
    mimeType,
    extension,
    segments,
    fullText,
    providerId: providerId || primaryCapture?.providerId,
    model: model || primaryCapture?.model || requestParams?.model
  });

  return {
    traceId,
    route,
    generatedAt: new Date().toISOString(),
    transcriptFromCache: Boolean(transcriptFromCache),
    winner: {
      providerId: providerId || primaryCapture?.providerId || null,
      backend: backend || primaryCapture?.backend || (providerId ? resolveBackendLabel(providerId) : null),
      engineFamily: engineFamily || primaryCapture?.engineFamily || null,
      model: model || primaryCapture?.model || requestParams?.model || null
    },
    requestParams: requestParams || primaryCapture?.requestParams || null,
    router: routerMeta || null,
    language: {
      clientHint: hintResolution?.clientHint ?? languageHint ?? null,
      effectiveHint: hintResolution?.languageHint ?? languageHint ?? null,
      hintSource: hintResolution?.source ?? null,
      preTranscription: preTranscription
        ? {
            language: preTranscription.language,
            confidence: preTranscription.languageConfidence,
            providerAgreement: preTranscription.providerAgreement
          }
        : null
    },
    accentRetranscribe: accentRetranscribe || null,
    chunking: {
      used: chunkDiagnostics.length > 0,
      chunkCount: chunkDiagnostics.length,
      chunks: chunkDiagnostics
    },
    captures: captures.map((c) => ({
      providerId: c.providerId,
      backend: c.backend,
      model: c.model,
      durationMs: c.durationMs,
      httpStatus: c.httpStatus,
      capturedAt: c.capturedAt,
      requestParams: c.requestParams
    })),
    audioComparison,
    quality,
    rawProviderSegmentCount: segments.length,
    diagnosticsNote:
      'Quality flags are heuristic (timeline gaps, logprobs, known hallucination patterns). Verify against source audio.'
  };
}

export async function captureTranscriptionAsrDiagnostics(opts = {}) {
  const {
    traceId,
    jobDir = null,
    audioBuffer,
    mimeType,
    extension,
    transcript,
    route,
    transcriptFromCache = false,
    languageHint = null,
    hintResolution = null,
    preTranscription = null,
    accentRetranscribe = null
  } = opts;

  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const fullText = String(transcript?.text || '');

  let audioDurationSec =
    Number(transcript?.durationSeconds) ||
    Number(transcript?.asrDiagnostics?.capture?.rawResponse?.duration) ||
    null;

  if (!audioDurationSec && audioBuffer?.length) {
    audioDurationSec = await probeAudioDurationWithFfprobe(audioBuffer, extension);
  }
  if (!audioDurationSec) {
    audioDurationSec = estimateAudioDurationSec({
      audioBuffer,
      mimeType,
      extension,
      providerDurationSec: transcript?.asrDiagnostics?.capture?.rawResponse?.duration,
      segmentMaxEnd: segments.length
        ? Math.max(...segments.map((s) => Number(s.end) || 0))
        : null
    });
  }

  const captures = [];
  if (transcript?.asrDiagnostics?.capture) {
    captures.push(transcript.asrDiagnostics.capture);
  }
  if (accentRetranscribe?.retryCapture) {
    captures.push(accentRetranscribe.retryCapture);
  }
  if (Array.isArray(transcript?.asrChunkCaptures)) {
    captures.push(...transcript.asrChunkCaptures);
  }

  const report = buildAsrDiagnosticsReport({
    traceId,
    route,
    transcriptFromCache,
    providerId: transcript?.provider || transcript?.asrDiagnostics?.winnerProviderId,
    model: transcript?.asrDiagnostics?.capture?.model,
    backend: transcript?.asrDiagnostics?.capture?.backend,
    engineFamily: transcript?.asrDiagnostics?.capture?.engineFamily,
    requestParams: transcript?.asrDiagnostics?.capture?.requestParams,
    routerMeta: transcript?.asrDiagnostics || null,
    captures,
    chunkDiagnostics: transcript?.asrChunkDiagnostics || [],
    segments,
    fullText,
    audioBuffer,
    mimeType,
    extension,
    languageHint,
    hintResolution,
    preTranscription,
    accentRetranscribe,
    audioDurationSec
  });

  const dirs = [resolveAsrDiagnosticsDir(traceId)];
  if (jobDir) dirs.push(jobDir);

  const written = [];
  const primaryRaw = captures[captures.length - 1]?.rawResponse ?? null;

  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
      const reportPath = join(dir, 'asr_diagnostics_report.json');
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      written.push(reportPath);

      if (primaryRaw) {
        const rawPath = join(dir, 'provider_raw_response.json');
        writeFileSync(rawPath, JSON.stringify(primaryRaw, null, 2), 'utf8');
        written.push(rawPath);
      }

      if (report.requestParams) {
        const paramsPath = join(dir, 'asr_request_params.json');
        writeFileSync(paramsPath, JSON.stringify(report.requestParams, null, 2), 'utf8');
        written.push(paramsPath);
      }

      const segmentsPath = join(dir, 'raw_provider_segments_snapshot.json');
      writeFileSync(segmentsPath, JSON.stringify(segments, null, 2), 'utf8');
      written.push(segmentsPath);
    } catch (err) {
      console.warn('[asr-diagnostics-save-failed]', {
        traceId,
        dir,
        message: err?.message || String(err)
      });
    }
  }

  console.log(
    JSON.stringify({
      event: 'asr_diagnostics_report_saved',
      traceId,
      route,
      providerId: report.winner.providerId,
      backend: report.winner.backend,
      model: report.winner.model,
      qualityConcern: report.quality.summary.qualityConcern,
      lowConfidenceCount: report.quality.summary.lowConfidenceCount,
      missedGapCount: report.quality.summary.missedGapCount,
      hallucinationCount: report.quality.summary.hallucinationCount,
      paths: written.slice(0, 6)
    })
  );

  return { report, written };
}
