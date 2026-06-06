/**
 * FFmpeg burn-in phase only (ASS already generated). Shared by VPS queue and GPU worker.
 */
import { copyFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  burnSubtitles,
  normalizeVideoForBurn,
  verifyNormalizedBurnSync,
  resolveSubtitleRenderGeometry
} from './ffmpeg-renderer.js';
import { parseAssDialogueTimes } from './ffmpeg-timeline.js';
import {
  recordFileStage,
  traceRenderTimeline,
  logSubtitleBurnTarget,
  summarizeSegmentTiming
} from './render-timeline-trace.js';
import { isTimingForensicEnabled, logTimingForensics } from './timing-forensics.js';
import { logCaptionForensics } from './caption-forensics.js';
import { isDebugExportEnabled } from './export-debug.js';

/**
 * @param {object} opts
 * @returns {Promise<object>}
 */
export async function executeBurnExportPhase(opts) {
  const {
    jobId = null,
    jobDir,
    videoPath,
    assPath,
    outputPath,
    quality = 'fast',
    probe,
    segments = [],
    assResult = null,
    renderGeometry: renderGeometryIn = null,
    hqSafeguards = false,
    isVertical = false,
    trustPreviewTimings = false,
    burnFromPreviewExportDoc = false,
    timelineTrace = null,
    subtitleCues: subtitleCuesIn = null,
    onProgress,
    signal
  } = opts;

  if (!videoPath || !assPath || !outputPath || !jobDir) {
    throw new Error('BURN_EXPORT_MISSING_PATHS');
  }

  const renderGeometry =
    renderGeometryIn ||
    resolveSubtitleRenderGeometry({
      sourceWidth: probe?.width,
      sourceHeight: probe?.height,
      quality,
      renderHints: {
        hqSafeguards,
        isVertical,
        sourceWidth: probe?.width,
        sourceHeight: probe?.height
      }
    });

  const normalizedPath = join(jobDir, 'normalized.cfr.mp4');
  const assBurnCues =
    subtitleCuesIn && subtitleCuesIn.length
      ? subtitleCuesIn
      : parseAssDialogueTimes(assPath, 500);
  const subtitleCues = assBurnCues.length
    ? assBurnCues
    : (segments || []).map((s) => ({
        start: s.start,
        end: s.end,
        text: String(s.text || '')
      }));

  if (isDebugExportEnabled() && assBurnCues.length) {
    console.log('[burn-subtitle-cues]', {
      source: 'ass-dialogues',
      cueCount: assBurnCues.length,
      firstCue: assBurnCues[0],
      previewExportDoc: Boolean(burnFromPreviewExportDoc)
    });
  }

  const singlePassExport =
    String(process.env.RENDER_SINGLE_PASS ?? '1').toLowerCase() !== '0';

  let burnInputPath = videoPath;
  let burnDurationSec = probe?.durationSec || 0;
  let inputAlreadyNormalized = false;
  let normResult = { skipped: true, sourceTiming: null, normalizedTiming: null };

  await recordFileStage(timelineTrace, videoPath, 'pre_burn_source');

  if (singlePassExport) {
    traceRenderTimeline(timelineTrace, 'single_pass_export', {
      burnInputPath: videoPath,
      note: 'One ffmpeg pass: timeline correction + CFR + burn'
    });
  } else {
    traceRenderTimeline(timelineTrace, 'normalize_cfr_start', {
      rawSource: videoPath,
      normalizedTarget: normalizedPath
    });

    normResult = await normalizeVideoForBurn({
      inputPath: videoPath,
      outputPath: normalizedPath,
      signal,
      onProgress,
      jobId
    });

    burnInputPath = normResult.skipped ? videoPath : normalizedPath;
    burnDurationSec = normResult.normalizedTiming?.formatDuration || burnDurationSec;
    inputAlreadyNormalized = !normResult.skipped;

    if (!normResult.skipped) {
      await recordFileStage(timelineTrace, normalizedPath, 'normalized_cfr_mp4');
      await verifyNormalizedBurnSync(subtitleCues, burnInputPath);
    }

    traceRenderTimeline(timelineTrace, 'normalize_cfr_complete', {
      skipped: normResult.skipped,
      burnInputPath,
      cfrFps: normResult.cfrFps
    });
  }

  const preBurnProbe = await recordFileStage(timelineTrace, burnInputPath, 'pre_burn_input');
  logSubtitleBurnTarget(timelineTrace, {
    subtitleSource: {
      type: 'ass file at burn',
      assPath,
      segmentFirstCue: summarizeSegmentTiming(segments),
      assFirstDialogue: parseAssDialogueTimes(assPath, 1)[0] || null
    },
    burnTarget: {
      burnInputPath,
      outputPath,
      singlePassExport,
      preBurnStreamOffsetSec: preBurnProbe?.streamOffsetSec
    }
  });

  const burnResult = await burnSubtitles({
    inputPath: burnInputPath,
    assPath,
    outputPath,
    quality,
    jobId,
    jobDir,
    timelineTrace,
    renderHints: {
      hqSafeguards,
      isVertical,
      sourceWidth: probe?.width,
      sourceHeight: probe?.height
    },
    durationSec: burnDurationSec,
    subtitleCues,
    inputAlreadyNormalized,
    trustPreviewTimings: Boolean(trustPreviewTimings),
    signal,
    onProgress
  });

  const exportAssPath = join(jobDir, 'export.ass');
  const burnAssPath = burnResult?.burnAssPath || resolve(assPath);
  copyFileSync(burnAssPath, exportAssPath);

  if (assResult?.timingAudit && isTimingForensicEnabled(segments?.[0]?.text || '')) {
    logTimingForensics({
      ...assResult.timingAudit,
      timelinePlan: burnResult?.timelinePlan || null,
      jobDir,
      jobId
    });
  }

  if (assResult?.forensicBundle) {
    logCaptionForensics({
      ...assResult.forensicBundle,
      timelinePlan: burnResult?.timelinePlan || null
    });
  }

  return {
    burnResult,
    normResult,
    burnInputPath,
    burnAssPath,
    exportAssPath,
    renderGeometry,
    subtitleCues
  };
}
