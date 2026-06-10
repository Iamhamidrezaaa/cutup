/**
 * Subtitle integrity audit — trace segment loss across pipeline stages.
 * Read-only diagnostics; does not alter transcription, translation, or styling.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildMasterCleanSrtFromSegments,
  validateMasterVsAss
} from './video-render/master-subtitle-cues.js';
import { buildCleanSrtWordLossReport } from './video-render/clean-srt-word-integrity.js';

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\-][\p{L}\p{M}\p{N}]+)*/gu;
const GAP_WARN_SEC = 1.5;
const SHORTEN_RATIO = 0.85;

function cueWords(text) {
  return String(text || '').match(TOKEN_RE) || [];
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

function intervalsOverlap(a, b) {
  return Number(a.start) < Number(b.end) && Number(b.start) < Number(a.end);
}

function cloneSegment(seg, index) {
  if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number') return null;
  const text = normalizeText(seg.text);
  if (!text) return null;
  return {
    index,
    id: seg.id || `seg-${index}`,
    start: roundSec(seg.start),
    end: roundSec(seg.end),
    text,
    wordCount: cueWords(text).length,
    charCount: text.length,
    locked: Boolean(seg.locked)
  };
}

export function cloneSegmentsForAudit(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((s, i) => cloneSegment(s, i))
    .filter(Boolean);
}

export function computeStageMetrics(segments) {
  const list = cloneSegmentsForAudit(segments);
  let wordCount = 0;
  let characterCount = 0;
  let durationSum = 0;
  for (const s of list) {
    wordCount += s.wordCount;
    characterCount += s.charCount;
    durationSum += Math.max(0, s.end - s.start);
  }
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const span =
    sorted.length > 0
      ? roundSec(sorted[sorted.length - 1].end - sorted[0].start)
      : 0;
  return {
    segmentCount: list.length,
    wordCount,
    characterCount,
    totalDurationCovered: roundSec(durationSum),
    timelineSpanSec: span,
    firstStart: sorted[0]?.start ?? null,
    lastEnd: sorted[sorted.length - 1]?.end ?? null
  };
}

function textRetained(beforeText, afterText) {
  const b = normalizeText(beforeText).toLowerCase();
  const a = normalizeText(afterText).toLowerCase();
  if (!b) return true;
  if (a.includes(b)) return true;
  const bWords = cueWords(b);
  if (!bWords.length) return true;
  const aWords = new Set(cueWords(a).map((w) => w.toLowerCase()));
  const kept = bWords.filter((w) => aWords.has(w.toLowerCase())).length;
  return kept / bWords.length >= 0.6;
}

export function compareSegmentStages(beforeSegments, afterSegments, opts = {}) {
  const before = cloneSegmentsForAudit(beforeSegments);
  const after = cloneSegmentsForAudit(afterSegments);
  const removedSegments = [];
  const mergedSegments = [];
  const shortenedSegments = [];

  for (const b of before) {
    const overlaps = after.filter((a) => intervalsOverlap(b, a));
    if (!overlaps.length) {
      removedSegments.push({
        type: 'segment_removed',
        beforeIndex: b.index,
        start: b.start,
        end: b.end,
        text: b.text,
        reason: opts.reason || 'no_overlap_in_next_stage'
      });
      continue;
    }
    const primary = overlaps[0];
    if (!textRetained(b.text, primary.text)) {
      removedSegments.push({
        type: 'segment_text_lost',
        beforeIndex: b.index,
        afterIndex: primary.index,
        start: b.start,
        end: b.end,
        text: b.text,
        afterText: primary.text,
        reason: 'text_not_retained_in_next_stage'
      });
    }
    const bDur = b.end - b.start;
    const aDur = primary.end - primary.start;
    if (bDur > 0.2 && aDur < bDur * SHORTEN_RATIO) {
      shortenedSegments.push({
        type: 'segment_shortened',
        beforeIndex: b.index,
        afterIndex: primary.index,
        beforeStart: b.start,
        beforeEnd: b.end,
        afterStart: primary.start,
        afterEnd: primary.end,
        beforeDur: roundSec(bDur),
        afterDur: roundSec(aDur),
        text: b.text
      });
    }
  }

  for (const a of after) {
    const overlappingBefore = before.filter((b) => intervalsOverlap(b, a));
    if (overlappingBefore.length > 1) {
      mergedSegments.push({
        type: 'segment_merged',
        afterIndex: a.index,
        start: a.start,
        end: a.end,
        text: a.text,
        mergedFromCount: overlappingBefore.length,
        mergedFrom: overlappingBefore.map((b) => ({
          index: b.index,
          start: b.start,
          end: b.end,
          text: b.text
        }))
      });
    }
  }

  return { removedSegments, mergedSegments, shortenedSegments };
}

export function findSuspiciousGaps(segments, referenceSegments, opts = {}) {
  const threshold = Number(opts.gapSec ?? GAP_WARN_SEC);
  const sorted = cloneSegmentsForAudit(segments).sort((a, b) => a.start - b.start);
  const reference = cloneSegmentsForAudit(referenceSegments);
  const suspiciousGaps = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const gapStart = cur.end;
    const gapEnd = next.start;
    const gapSec = gapEnd - gapStart;
    if (gapSec <= threshold) continue;

    const refInGap = reference.filter(
      (r) => r.start < gapEnd && r.end > gapStart && r.wordCount >= 1
    );
    if (!refInGap.length) continue;

    suspiciousGaps.push({
      type: 'timing_gap_while_speech_exists',
      gapStart: roundSec(gapStart),
      gapEnd: roundSec(gapEnd),
      gapSec: roundSec(gapSec),
      afterCueIndex: cur.index,
      beforeCueIndex: next.index,
      referenceSegmentsInGap: refInGap.map((r) => ({
        index: r.index,
        start: r.start,
        end: r.end,
        text: r.text
      }))
    });
  }
  return suspiciousGaps;
}

export function buildSubtitleIntegrityReport(opts = {}) {
  const {
    traceId = null,
    jobId = null,
    rawProvider = [],
    postProcessed = [],
    cleanSrt = [],
    exportedSegments = [],
    stageLabels = {}
  } = opts;

  const raw = cloneSegmentsForAudit(rawProvider);
  const processed = cloneSegmentsForAudit(postProcessed);
  const clean = cloneSegmentsForAudit(cleanSrt);
  const exported = cloneSegmentsForAudit(exportedSegments);

  const rawToProcessed = compareSegmentStages(raw, processed, {
    reason: 'removed_during_post_processing'
  });
  const processedToClean = compareSegmentStages(processed, clean, {
    reason: 'removed_during_clean_srt'
  });
  const cleanToExport =
    exported.length > 0 ? compareSegmentStages(clean, exported, { reason: 'removed_before_export' }) : {
      removedSegments: [],
      mergedSegments: [],
      shortenedSegments: []
    };

  const suspiciousGapsClean = findSuspiciousGaps(clean, raw.length ? raw : processed);
  const suspiciousGapsExport =
    exported.length > 0 ? findSuspiciousGaps(exported, clean.length ? clean : processed) : [];

  const assSync =
    exported.length > 0 && clean.length > 0
      ? validateMasterVsAss(
          clean.map((c) => ({ ...c, locked: true })),
          exported.map((e, i) => ({
            id: e.id,
            assStart: e.start,
            assEnd: e.end
          }))
        )
      : null;

  const removedSegments = [
    ...rawToProcessed.removedSegments,
    ...processedToClean.removedSegments,
    ...cleanToExport.removedSegments
  ];
  const mergedSegments = [
    ...rawToProcessed.mergedSegments,
    ...processedToClean.mergedSegments,
    ...cleanToExport.mergedSegments
  ];
  const shortenedSegments = [
    ...rawToProcessed.shortenedSegments,
    ...processedToClean.shortenedSegments,
    ...cleanToExport.shortenedSegments
  ];
  const suspiciousGaps = [...suspiciousGapsClean, ...suspiciousGapsExport];

  const warnings = [];
  for (const r of removedSegments) warnings.push({ code: 'segment_removed', ...r });
  for (const m of mergedSegments) warnings.push({ code: 'segment_merged', ...m });
  for (const s of shortenedSegments) warnings.push({ code: 'segment_shortened', ...s });
  for (const g of suspiciousGaps) warnings.push({ code: 'suspicious_gap', ...g });
  if (assSync && !assSync.ok) {
    warnings.push({
      code: 'export_clean_srt_mismatch',
      reasons: assSync.reasons
    });
  }

  return {
    traceId,
    jobId,
    generatedAt: new Date().toISOString(),
    rawSegments: raw.length,
    cleanedSegments: clean.length,
    exportedSegments: exported.length,
    postProcessedSegments: processed.length,
    stages: {
      rawProvider: {
        label: stageLabels.rawProvider || 'raw_provider',
        ...computeStageMetrics(rawProvider)
      },
      postProcessed: {
        label: stageLabels.postProcessed || 'post_processed',
        ...computeStageMetrics(postProcessed)
      },
      cleanSrt: {
        label: stageLabels.cleanSrt || 'clean_srt',
        ...computeStageMetrics(cleanSrt)
      },
      exportMp4: {
        label: stageLabels.exportMp4 || 'export_mp4',
        ...computeStageMetrics(exportedSegments)
      }
    },
    removedSegments,
    mergedSegments,
    shortenedSegments,
    suspiciousGaps,
    warnings,
    exportMatchesCleanSrt: assSync ? assSync.ok : null,
    exportSyncDetails: assSync
  };
}

export function resolveSubtitleIntegrityDir(traceId) {
  const id = String(traceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return join(tmpdir(), 'cutup-subtitle-integrity', id);
}

export function saveSubtitleIntegrityArtifacts(opts = {}) {
  const {
    traceId,
    jobDir = null,
    report,
    stages = {}
  } = opts;

  const dirs = [resolveSubtitleIntegrityDir(traceId)];
  if (jobDir) dirs.push(jobDir);

  const written = [];
  for (const dir of dirs) {
    try {
      mkdirSync(join(dir, 'stages'), { recursive: true });
      const stageFiles = {
        raw_provider_segments: stages.rawProvider,
        post_processed_segments: stages.postProcessed,
        clean_srt_segments: stages.cleanSrt,
        export_mp4_segments: stages.exportMp4
      };
      for (const [name, segments] of Object.entries(stageFiles)) {
        if (!Array.isArray(segments)) continue;
        const path = join(dir, 'stages', `${name}.json`);
        writeFileSync(path, JSON.stringify(cloneSegmentsForAudit(segments), null, 2), 'utf8');
        written.push(path);
      }
      const reportPath = join(dir, 'subtitle_integrity_report.json');
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      written.push(reportPath);
    } catch (err) {
      console.warn('[subtitle-integrity-save-failed]', {
        traceId,
        dir,
        message: err?.message || String(err)
      });
    }
  }

  console.log(
    JSON.stringify({
      event: 'subtitle_integrity_report_saved',
      traceId,
      jobDir: jobDir || null,
      rawSegments: report?.rawSegments,
      cleanedSegments: report?.cleanedSegments,
      exportedSegments: report?.exportedSegments,
      warningCount: report?.warnings?.length || 0,
      removedCount: report?.removedSegments?.length || 0,
      suspiciousGapCount: report?.suspiciousGaps?.length || 0,
      exportMatchesCleanSrt: report?.exportMatchesCleanSrt,
      paths: written.slice(0, 6)
    })
  );

  return { written, report };
}

/**
 * Transcription/upload path — save raw → post-process → clean SRT snapshots.
 */
export function captureTranscriptionSubtitleIntegrity(opts = {}) {
  const {
    traceId,
    rawProvider = [],
    afterValidFilter = [],
    afterWordSync = [],
    afterOffset = [],
    afterPostProcess = []
  } = opts;

  const postProcessed = afterPostProcess?.length ? afterPostProcess : afterOffset;
  let cleanSrt;
  let wordLossReport = null;
  try {
    cleanSrt = buildMasterCleanSrtFromSegments(postProcessed, { shortForm: true, traceId });
    wordLossReport = buildCleanSrtWordLossReport(postProcessed, cleanSrt);
  } catch (err) {
    wordLossReport = err?.report || buildCleanSrtWordLossReport(postProcessed, []);
    console.error('[subtitle-integrity-clean-srt-build-failed]', {
      traceId,
      code: err?.code || null,
      message: err?.message || String(err),
      wordLossReport
    });
    throw err;
  }

  const report = buildSubtitleIntegrityReport({
    traceId,
    rawProvider,
    postProcessed,
    cleanSrt,
    exportedSegments: []
  });

  const transitions = [
    { from: 'rawProvider', to: 'afterValidFilter', a: rawProvider, b: afterValidFilter },
    { from: 'afterValidFilter', to: 'afterWordSync', a: afterValidFilter, b: afterWordSync },
    { from: 'afterWordSync', to: 'afterOffset', a: afterWordSync, b: afterOffset },
    { from: 'afterOffset', to: 'afterPostProcess', a: afterOffset, b: afterPostProcess },
    { from: 'afterPostProcess', to: 'cleanSrt', a: postProcessed, b: cleanSrt }
  ];
  report.stageTransitions = transitions.map((t) => ({
    from: t.from,
    to: t.to,
    ...compareSegmentStages(t.a, t.b)
  }));
  report.wordLoss = wordLossReport;

  if (report.warnings.length > 0) {
    console.warn(
      JSON.stringify({
        event: 'subtitle_integrity_warnings',
        traceId,
        warningCount: report.warnings.length,
        removedCount: report.removedSegments.length,
        suspiciousGapCount: report.suspiciousGaps.length,
        sample: report.warnings.slice(0, 5)
      })
    );
  } else {
    console.log(
      JSON.stringify({
        event: 'subtitle_integrity_passed',
        traceId,
        rawSegments: report.rawSegments,
        cleanedSegments: report.cleanedSegments
      })
    );
  }

  return saveSubtitleIntegrityArtifacts({
    traceId,
    report,
    stages: {
      rawProvider,
      postProcessed,
      cleanSrt
    }
  });
}

/**
 * MP4 export path — prove clean SRT matches burned ASS cues.
 */
export function captureExportSubtitleIntegrity(opts = {}) {
  const {
    traceId,
    jobId,
    jobDir,
    rawProvider = [],
    postProcessed = [],
    cleanSrtSegments = [],
    assTimingAudit = null
  } = opts;

  const exportedSegments = (assTimingAudit?.assDialogues || []).map((d, i) => ({
    id: d.id || `ass-${i}`,
    start: Number(d.assStart),
    end: Number(d.assEnd),
    text: String(d.text || '')
  }));

  const report = buildSubtitleIntegrityReport({
    traceId,
    jobId,
    rawProvider,
    postProcessed: postProcessed.length ? postProcessed : cleanSrtSegments,
    cleanSrt: cleanSrtSegments,
    exportedSegments
  });

  if (!report.exportMatchesCleanSrt) {
    console.error(
      JSON.stringify({
        event: 'subtitle_integrity_export_mismatch',
        traceId,
        jobId,
        reasons: report.exportSyncDetails?.reasons?.slice(0, 8) || []
      })
    );
  }

  return saveSubtitleIntegrityArtifacts({
    traceId,
    jobDir,
    report,
    stages: {
      rawProvider: rawProvider.length ? rawProvider : null,
      postProcessed: postProcessed.length ? postProcessed : null,
      cleanSrt: cleanSrtSegments,
      exportMp4: exportedSegments
    }
  });
}
