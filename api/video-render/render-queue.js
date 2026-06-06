/**
 * In-process render queue with concurrency limits and progress tracking.
 */
import { randomBytes } from 'crypto';
import { writeFileSync, copyFileSync, statSync } from 'fs';
import { promises as fsp } from 'fs';
import { getStylePreset } from './style-presets.js';
import { join, resolve } from 'path';
import { generateAssContent, generateAssFromExportDoc } from './ass-generator.js';
import {
  probeVideo,
  checkFfmpegAvailable,
  resolveSubtitleRenderGeometry
} from './ffmpeg-renderer.js';
import { executeBurnExportPhase } from './burn-export-phase.js';
import {
  isGpuRenderEnabled,
  dispatchGpuRenderJob,
  downloadGpuRenderOutput
} from './gpu-render-client.js';
import { registerGpuRenderArtifacts, purgeExpiredGpuArtifacts } from './gpu-render-artifacts.js';
import {
  createJobDir,
  downloadVideoFromUrl,
  saveUploadedVideo,
  stageLocalPath
} from './source-resolver.js';
import { cleanupJobArtifacts } from './temp-cleanup.js';
import { resolvePresetIdOrThrow } from './style-presets.js';
import {
  createRenderTimelineTrace,
  recordFileStage,
  traceRenderTimeline,
  logSubtitleBurnTarget,
  summarizeSegmentTiming,
  diffTimelineStages,
  emitFinalRenderSyncReport,
  isHardSyncTestEnabled
} from './render-timeline-trace.js';
import { parseAssDialogueTimes } from './ffmpeg-timeline.js';
import { isTimingForensicEnabled, logTimingForensics } from './timing-forensics.js';
import { logCaptionForensics } from './caption-forensics.js';
import { logExportRootCauseForensics } from './export-root-cause-forensics.js';
import { logPhraseTimingForensics } from './phrase-timing-forensics.js';
import { logWhisperStarttimeForensics } from './whisper-starttime-forensics.js';
import { logRtlPhraseOrderForensics } from './rtl-phrase-order-forensics.js';
import { logCaptionPositionForensics } from './caption-position-forensics.js';
import { logLineLayoutForensics } from './line-layout-forensics.js';
import { logFirstCaptionForensics } from './first-caption-forensics.js';
import { logProductionAssDialogueDump } from './subtitle-text-forensics.js';
import { trackExportStart, trackExportEnd } from './ffmpeg-job-tracker.js';
import {
  initExportStageTimings,
  beginExportStage,
  endExportStage,
  printExportStageTimings
} from './export-stage-timings.js';

const MAX_CONCURRENT = Math.max(1, Math.min(3, Number(process.env.VIDEO_RENDER_CONCURRENCY || 1)));
const JOB_TTL_MS = Number(process.env.VIDEO_RENDER_JOB_TTL_MS || 30 * 60 * 1000);
const MAX_DURATION_SEC = Number(process.env.VIDEO_RENDER_MAX_DURATION_SEC || 180);

const FFMPEG_STATUS_LINES = [
  'Encoding TikTok-ready MP4…',
  'Compositing subtitle layer…',
  'Optimizing captions for mobile readability…',
  'Muxing audio and video…',
  'Optimizing for TikTok playback…',
  'Polishing social-ready output…'
];
const RTL_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** @type {Map<string, object>} */
const jobs = new Map();
let activeCount = 0;
/** @type {string[]} */
const waitQueue = [];
const recentRenderStats = [];
const MAX_RECENT_STATS = 40;

function newJobId() {
  return `vr_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function recordRenderStat(entry) {
  recentRenderStats.push(entry);
  if (recentRenderStats.length > MAX_RECENT_STATS) recentRenderStats.splice(0, recentRenderStats.length - MAX_RECENT_STATS);
}

function averageRenderSec(quality = null) {
  const list = recentRenderStats.filter((s) => (quality ? s.quality === quality : true));
  if (!list.length) return quality === 'hq' ? 120 : 75;
  const total = list.reduce((sum, item) => sum + Math.max(1, Number(item.renderSec || 0)), 0);
  return total / list.length;
}

function estimateQueueWaitSecFor(jobId, quality) {
  const idx = waitQueue.indexOf(jobId);
  if (idx < 0) return 0;
  const slots = Math.max(1, MAX_CONCURRENT);
  const avg = averageRenderSec(quality);
  const batchesAhead = Math.floor(idx / slots);
  const activePenalty = activeCount > 0 ? 0.6 : 0;
  return Math.max(0, Math.round((batchesAhead + activePenalty) * avg));
}

function memorySnapshotMb() {
  const m = process.memoryUsage();
  return {
    rssMb: Math.round((m.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMb: Math.round((m.heapUsed / (1024 * 1024)) * 10) / 10,
    externalMb: Math.round((m.external / (1024 * 1024)) * 10) / 10
  };
}

function estimateSubtitleCount(job) {
  if (Array.isArray(job.segments) && job.segments.length) return job.segments.length;
  if (Array.isArray(job.exportDoc?.cues) && job.exportDoc.cues.length) return job.exportDoc.cues.length;
  return 0;
}

function hasRtlContent(job) {
  const sample = (Array.isArray(job.segments) && job.segments.length ? job.segments : job.exportDoc?.cues || [])
    .slice(0, 120)
    .map((s) => String(s?.text || (s?.lines || []).join(' ')))
    .join(' ');
  return RTL_CHAR_RE.test(sample);
}

function resolveStyleMode(job) {
  const requested = String(job.styleMode || '').toLowerCase();
  if (requested === 'safe' || requested === 'cinematic' || requested === 'aggressive') return requested;
  if (job.captionMode === 'accurate' || job.captionMode === 'clean') return 'safe';
  return job.quality === 'fast' ? 'aggressive' : 'cinematic';
}

function summarizeDiagnostics(job, probe, assResult, timings, ffmpegStats) {
  return {
    jobId: job.id,
    quality: job.quality,
    styleMode: job.styleMode,
    presetId: job.presetId,
    selectedVersion: job.selectedVersion || 'original',
    durationSec: Number((probe?.durationSec || 0).toFixed(3)),
    resolution: `${probe?.width || 0}x${probe?.height || 0}`,
    outputResolution: String(job.resolution || ''),
    timingsMs: {
      total: timings.totalMs,
      assGeneration: timings.assGenerationMs,
      ffmpeg: timings.ffmpegMs
    },
    queueWaitSec: timings.queueWaitSec,
    subtitle: {
      cues: assResult?.cueCount || 0,
      density: assResult?.density || null,
      continuity: assResult?.continuity || null,
      visualContinuity: assResult?.visualContinuity || null,
      visibility: assResult?.visibility || null,
      readabilityScore: assResult?.readabilityScore ?? null,
      droppedCueDetected: !Boolean(assResult?.cueIntegrity?.ok),
      visibilityWarnings: assResult?.visibility?.warnings || []
    },
    ffmpeg: {
      avgSpeedX: ffmpegStats?.avgSpeedX ?? null,
      avgFps: ffmpegStats?.avgFps ?? null,
      samples: ffmpegStats?.samples || 0
    },
    memory: {
      start: timings.memStart,
      end: timings.memEnd
    },
    generatedAt: new Date().toISOString()
  };
}

function toSafeRenderError(err) {
  const msg = String(err?.message || err || '').trim();
  if (/SUBTITLE_INTEGRITY_LOSS/i.test(msg) || String(err?.code || '') === 'SUBTITLE_INTEGRITY_LOSS') {
    return 'Export stopped because subtitle integrity validation failed. No words were removed.';
  }
  if (/SUBTITLE_VISIBILITY_LOSS/i.test(msg) || String(err?.code || '') === 'SUBTITLE_VISIBILITY_LOSS') {
    return 'Export stopped because subtitle visibility validation failed.';
  }
  if (/PRESET_NOT_APPLIED/i.test(msg) || String(err?.code || '') === 'PRESET_NOT_APPLIED') {
    return 'Selected subtitle style could not be applied. Please choose a valid preset.';
  }
  if (/timed out|timeout|stalled/i.test(msg)) {
    return 'HQ cinematic rendering takes longer for premium exports. Please try Fast preview or a shorter clip.';
  }
  if (/Render cancelled/i.test(msg)) return 'Render was cancelled.';
  return msg || 'Export failed. Please try again.';
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extractAssDebugInfo(assContent) {
  const text = String(assContent || '');
  const playResX = Number((text.match(/^\s*PlayResX:\s*(\d+)/m) || [])[1] || 0);
  const playResY = Number((text.match(/^\s*PlayResY:\s*(\d+)/m) || [])[1] || 0);
  const styleLine =
    text
      .split(/\r?\n/)
      .find((line) => line.startsWith('Style:,Default,')) ||
    text
      .split(/\r?\n/)
      .find((line) => line.startsWith('Style: Default,')) ||
    '';
  const styleParts = styleLine.split(',');
  const styleName = String((styleParts[0] || '').replace(/^Style:\s*/, '') || 'Default');
  const fontSize = Number(styleParts[2] || 0);
  const alignment = Number(styleParts[18] || 0);
  const marginV = Number(styleParts[21] || 0);
  return {
    playResX,
    playResY,
    fontSize,
    marginV,
    alignment,
    styleName
  };
}

export function isJobReady(job) {
  return job && (job.stageKey === 'ready_to_download' || job.stageKey === 'completed');
}

function bumpProgress(job, target) {
  const t = Math.min(99, Math.max(job.progress || 0, target));
  if (t > job.progress) {
    job.progress = t;
    job.updatedAt = Date.now();
  }
}

function setStage(job, stage, extra = {}) {
  job.stage = stage;
  job.stageKey = stage;
  if (extra.stageLabel) job.stageLabel = extra.stageLabel;
  if (extra.subStageLabel) job.subStageLabel = extra.subStageLabel;
  if (extra.progress != null) bumpProgress(job, extra.progress);
  job.updatedAt = Date.now();
  Object.assign(job, extra);
}

function setSubStage(job, label, progress) {
  job.subStageLabel = label;
  bumpProgress(job, progress);
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function createRenderJob(payload) {
  const id = newJobId();
  const resolvedPresetId = resolvePresetIdOrThrow(payload.presetId);
  const presetDef = getStylePreset(resolvedPresetId);
  const job = {
    id,
    userEmail: payload.userEmail,
    sessionId: payload.sessionId,
    presetId: resolvedPresetId,
    quality: payload.quality === 'hq' ? 'hq' : 'fast',
    captionMode: ['accurate', 'clean', 'viral'].includes(String(payload.captionMode || '').toLowerCase())
      ? String(payload.captionMode).toLowerCase()
      : 'viral',
    styleMode: ['safe', 'cinematic', 'aggressive'].includes(String(payload.styleMode || '').toLowerCase())
      ? String(payload.styleMode).toLowerCase()
      : null,
    selectedVersion: String(payload.selectedVersion || 'original'),
    positionMode: payload.positionMode || 'adaptive',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stage: 'queued',
    stageKey: 'queued',
    stageLabel: 'Queued',
    subStageLabel: 'Starting export engine…',
    progress: 3,
    error: null,
    outputPath: null,
    outputFilename: 'cutup-viral-export.mp4',
    jobDir: null,
    assPath: null,
    cancelled: false,
    ffmpegAbort: null,
    progressTimer: null,
    ffmpegMsgIndex: 0,
    segments: payload.segments || null,
    exportDoc: payload.exportDoc || null,
    captionForensics: payload.captionForensics || null,
    upstreamStageTimings: payload.upstreamStageTimings || null,
    sourceUrl: payload.sourceUrl || null,
    localVideoPath: payload.localVideoPath || null,
    uploadBuffer: payload.uploadBuffer || null,
    uploadFilename: payload.uploadFilename || null,
    traceId: payload.traceId || null,
    etaSec: null,
    queueWaitSec: 0,
    queueEtaSec: 0,
    renderStartedAt: Date.now(),
    processingStartedAt: null,
    fileSizeBytes: null,
    resolution: null,
    videoDurationSec: null,
    renderDurationSec: null,
    renderSpeedX: null,
    renderFps: null,
    diagnosticsPath: null,
    diagnostics: null,
    presetDisplayName: presetDef.name
  };
  jobs.set(id, job);
  waitQueue.push(id);
  job.queueEtaSec = estimateQueueWaitSecFor(id, job.quality);
  pumpQueue();
  return { jobId: id, status: publicStatus(job) };
}

export function cancelJob(jobId, userEmail) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, code: 'NOT_FOUND' };
  if (job.userEmail !== userEmail) return { ok: false, code: 'FORBIDDEN' };
  if (isJobReady(job) || job.stageKey === 'failed' || job.stageKey === 'cancelled') {
    return { ok: false, code: 'ALREADY_DONE' };
  }
  job.cancelled = true;
  if (job.progressTimer) clearInterval(job.progressTimer);
  job.ffmpegAbort?.abort?.();
  setStage(job, 'cancelled', { stageLabel: 'Cancelled', progress: 0 });
  return { ok: true };
}

function startRenderHeartbeat(job, durationSec) {
  if (job.progressTimer) clearInterval(job.progressTimer);
  const estMs = Math.max(25000, (durationSec || 60) * (job.quality === 'hq' ? 2000 : 1100));
  const started = Date.now();
  let tick = 0;

  job.progressTimer = setInterval(() => {
    if (job.stageKey !== 'rendering' && job.stageKey !== 'muxing') return;
    tick += 1;
    const elapsed = Date.now() - started;
    const ratio = Math.min(1, elapsed / estMs);
    const micro = 52 + Math.round(ratio * 36);
    bumpProgress(job, micro);

    job.ffmpegMsgIndex = tick % FFMPEG_STATUS_LINES.length;
    job.subStageLabel = FFMPEG_STATUS_LINES[job.ffmpegMsgIndex];
    job.updatedAt = Date.now();
    job.etaSec = Math.max(3, Math.round((estMs - elapsed) / 1000));

    if (micro < 88 && tick % 2 === 0) {
      bumpProgress(job, micro + 1);
    }
  }, 1400);
  job.progressTimer.unref?.();
}

function stopRenderHeartbeat(job) {
  if (job.progressTimer) {
    clearInterval(job.progressTimer);
    job.progressTimer = null;
  }
}

export function publicStatus(job) {
  if (!job) return null;
  const ready = isJobReady(job);
  const queued = !ready && job.stageKey === 'queued';
  const queueEtaSec = queued ? estimateQueueWaitSecFor(job.id, job.quality) : 0;
  const stageLabel = ready
    ? job.subStageLabel || 'Your viral clip is ready'
    : queued && queueEtaSec > 0
      ? `Queued (~${queueEtaSec}s wait)`
      : job.subStageLabel || job.stageLabel || job.stage;
  return {
    jobId: job.id,
    stage: ready ? 'ready_to_download' : job.stageKey || job.stage,
    stageLabel,
    subStageLabel: job.subStageLabel || null,
    progress: ready ? 100 : job.progress,
    error: job.error,
    etaSec: ready ? 0 : job.etaSec,
    queueWaitSec: job.queueWaitSec || 0,
    queueEtaSec,
    renderSpeedX: ready ? job.renderSpeedX : job.renderSpeedX || null,
    renderFps: ready ? job.renderFps : job.renderFps || null,
    outputReady: ready,
    downloadFilename: job.outputFilename || 'cutup-viral-export.mp4',
    fileSizeBytes: job.fileSizeBytes,
    fileSizeLabel: job.fileSizeBytes != null ? formatFileSize(job.fileSizeBytes) : null,
    resolution: job.resolution,
    videoDurationSec: job.videoDurationSec,
    renderDurationSec: job.renderDurationSec,
    readabilityScore: job.diagnostics?.subtitle?.readabilityScore ?? null,
    visibilityWarnings: job.diagnostics?.subtitle?.visibilityWarnings || [],
    styleMode: job.styleMode || null,
    selectedVersion: job.selectedVersion || 'original',
    presetId: job.presetId,
    presetName: job.presetDisplayName || job.presetId,
    quality: job.quality
  };
}

function pumpQueue() {
  while (activeCount < MAX_CONCURRENT && waitQueue.length) {
    const id = waitQueue.shift();
    const job = jobs.get(id);
    if (!job || job.cancelled) continue;
    activeCount += 1;
    runJob(job)
      .catch((err) => {
        console.error('[video-render] job failed:', job.id, err?.message || err);
        job.error = toSafeRenderError(err);
        setStage(job, 'failed', { stageLabel: 'Export failed', progress: 0 });
      })
      .finally(() => {
        activeCount -= 1;
        pumpQueue();
      });
  }
}

async function runJob(job) {
  if (job.cancelled) return;

  const ffmpegOk = await checkFfmpegAvailable();
  if (!ffmpegOk) throw new Error('FFmpeg is not available on this server');

  job.jobDir = createJobDir();
  let videoPath = null;
  const queueStartedAt = Date.now();
  const memStart = memorySnapshotMb();
  const assTiming = { start: 0, end: 0 };
  const ffmpegStartedAt = { at: 0 };
  const ffmpegStats = { speedSum: 0, fpsSum: 0, speedSamples: 0, fpsSamples: 0 };
  job.processingStartedAt = Date.now();
  job.queueWaitSec = Math.max(0, Math.round((job.processingStartedAt - job.createdAt) / 1000));
  job.queueEtaSec = 0;
  job.styleMode = resolveStyleMode(job);
  const timelineTrace = createRenderTimelineTrace(job.id, job.traceId);
  job.timelineTrace = timelineTrace;

  trackExportStart(job.id);
  initExportStageTimings(job.id, job.upstreamStageTimings);

  try {
    traceRenderTimeline(timelineTrace, 'job_start', {
      sourceType: job.localVideoPath ? 'local' : job.uploadBuffer ? 'upload' : job.sourceUrl ? 'url' : 'unknown',
      sourceUrl: job.sourceUrl ? String(job.sourceUrl).slice(0, 120) : null,
      segmentTiming: summarizeSegmentTiming(job.segments)
    });

    setStage(job, 'preparing', {
      stageLabel: 'Preparing',
      subStageLabel: 'Fetching source footage…',
      progress: 10
    });

    let rawVideoPath = null;
    if (job.localVideoPath) {
        beginExportStage(job.id, 'normalize_staged_copy');
        videoPath = stageLocalPath(job.localVideoPath, job.jobDir);
        endExportStage(job.id, 'normalize_staged_copy');
        rawVideoPath = videoPath;
        traceRenderTimeline(timelineTrace, 'source_local_staged', { path: videoPath });
      } else if (job.uploadBuffer) {
        beginExportStage(job.id, 'normalize_staged_copy');
        videoPath = saveUploadedVideo({
          buffer: job.uploadBuffer,
          filename: job.uploadFilename || 'upload.mp4',
          jobDir: job.jobDir
        });
        endExportStage(job.id, 'normalize_staged_copy');
        rawVideoPath = videoPath;
        traceRenderTimeline(timelineTrace, 'source_upload_saved', { path: videoPath });
      } else if (job.sourceUrl) {
        setSubStage(job, 'Downloading video for export…', 14);
        beginExportStage(job.id, 'download_ytdlp_raw');
        const dl = await downloadVideoFromUrl({
          url: job.sourceUrl,
          userEmail: job.userEmail,
          traceId: job.traceId
        });
        endExportStage(job.id, 'download_ytdlp_raw');
        videoPath = dl.videoPath;
        rawVideoPath = dl.videoPath;
        job.downloadJobDir = dl.jobDir;
        const dlProbe = await recordFileStage(timelineTrace, dl.videoPath, 'download_ytdlp_raw');
        traceRenderTimeline(timelineTrace, 'source_download_complete', {
          downloadJobDir: dl.jobDir,
          fromCache: Boolean(dl.fromCache),
          platform: dl.platform,
          urlNormalized: dl.urlNormalized,
          ...dlProbe
        });
    } else {
      throw new Error('No video source provided (URL or upload required)');
    }

    if (job.cancelled) return;

    const stagedVideo = join(job.jobDir, 'source.mp4');
    const beforeStageProbe = await recordFileStage(timelineTrace, videoPath, 'pre_copy_to_job_source');
    if (videoPath !== stagedVideo) {
      beginExportStage(job.id, 'normalize_staged_copy');
      copyFileSync(videoPath, stagedVideo);
      endExportStage(job.id, 'normalize_staged_copy');
      videoPath = stagedVideo;
      traceRenderTimeline(timelineTrace, 'normalize_staged_copy', {
        from: rawVideoPath,
        to: stagedVideo,
        operation: 'copyFileSync',
        trimStart: null,
        trimEnd: null,
        concat: false,
        silenceRemoval: false,
        introInsertion: false
      });
    }
    const stagedProbe = await recordFileStage(timelineTrace, videoPath, 'staged_source_mp4');
    if (beforeStageProbe && stagedProbe && !beforeStageProbe.missing && !stagedProbe.missing) {
      const diff = diffTimelineStages(beforeStageProbe, stagedProbe);
      if (diff && (Math.abs(diff.videoStartDelta) > 0.01 || Math.abs(diff.streamOffsetDelta) > 0.01)) {
        timelineTrace.intermediateOffsets.push({ stage: 'staged_copy', diff });
        traceRenderTimeline(timelineTrace, 'intermediate_offset_detected', diff);
      }
    }

    setSubStage(job, 'Analyzing video dimensions…', 24);
    const probe = await probeVideo(videoPath);
    traceRenderTimeline(timelineTrace, 'probe_basic', {
      originalSourceDurationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      rotation: probe.rotation,
      processedVideoDurationSec: probe.durationSec,
      processedAudioDurationSec: probe.durationSec,
      timelineStart: 0,
      note: 'probeVideo uses v:0 stream only; full A/V timeline in staged_source_mp4 stage'
    });
    if (probe.durationSec > MAX_DURATION_SEC) {
      throw new Error(`Video exceeds maximum length (${MAX_DURATION_SEC}s). Trim your clip and try again.`);
    }

    const subtitleCount = estimateSubtitleCount(job);
    const rtl = hasRtlContent(job);
    const isVertical = probe.height > probe.width * 1.05;
    const hqSafeguards =
      job.quality === 'hq' && (probe.durationSec > 120 || subtitleCount > 220 || rtl || isVertical);
    const renderGeometry = resolveSubtitleRenderGeometry({
      sourceWidth: probe.width,
      sourceHeight: probe.height,
      quality: job.quality,
      renderHints: {
        hqSafeguards,
        isVertical,
        sourceWidth: probe.width,
        sourceHeight: probe.height
      }
    });
    job.etaSec = Math.max(10, Math.round(probe.durationSec * (job.quality === 'hq' ? 1.45 : 0.9)));

    setStage(job, 'subtitle_layout', {
      stageLabel: 'Subtitle layout',
      subStageLabel: 'Optimizing captions…',
      progress: 34
    });
    beginExportStage(job.id, 'caption_generation');

    const assOpts = {
      playResX: renderGeometry.playResX,
      playResY: renderGeometry.playResY,
      durationSec: probe.durationSec,
      positionMode: job.positionMode,
      captionMode: job.captionMode || 'viral',
      quality: job.quality,
      renderHints: {
        forceSafeguards: hqSafeguards,
        styleMode: job.styleMode
      },
      forensicCtx: {
        jobId: job.id,
        traceId: job.traceId || null,
        jobDir: job.jobDir,
        previewRows: job.captionForensics?.previewRows || [],
        transcriptSegments: job.captionForensics?.transcriptSegments || [],
        translatedSegments: job.captionForensics?.translatedSegments || [],
        previewPresetId: job.captionForensics?.stylePreset || job.presetId,
        previewStyleObject: job.captionForensics?.previewStyleObject || null,
        selectedPresetFromUI: job.captionForensics?.selectedPresetFromUI || null,
        presetReceivedByAPI: job.captionForensics?.presetReceivedByAPI || null,
        presetReceivedByRenderQueue: job.presetId
      }
    };

    console.log('[caption-forensics-preset-lineage]', {
      traceId: job.traceId || null,
      jobId: job.id,
      selectedPresetFromUI: job.captionForensics?.selectedPresetFromUI || null,
      presetReceivedByAPI: job.captionForensics?.presetReceivedByAPI || null,
      presetReceivedByRenderQueue: job.presetId
    });

    console.log('[preset-style-debug]', {
      requestedPreset: job.presetId,
      resolvedPreset: job.presetId,
      presetDisplayName: job.presetDisplayName || job.presetId,
      captionMode: job.captionMode,
      styleMode: job.styleMode,
      segmentCount: job.segments?.length || job.exportDoc?.cues?.length || 0,
      note: 'Full style fields logged in generateAssContent [preset-style-debug]'
    });

    setSubStage(job, 'Applying cinematic layout…', 40);

    let assResult;
    endExportStage(job.id, 'caption_generation');
    beginExportStage(job.id, 'ass_generation');
    assTiming.start = Date.now();
    const previewExportDoc =
        job.exportDoc?.format === 'cutup-style-v1' && Array.isArray(job.exportDoc.cues) && job.exportDoc.cues.length
          ? job.exportDoc
          : null;
      const usePreviewBurn =
        Boolean(previewExportDoc) && String(job.captionMode || 'viral').toLowerCase() !== 'accurate';
      if (previewExportDoc && !usePreviewBurn) {
        console.log('[preview-burn-skipped]', {
          jobId: job.id,
          captionMode: job.captionMode,
          reason: 'accurate/clean mode uses source-aligned ASS'
        });
      }
      if (previewExportDoc && usePreviewBurn && job.segments?.length) {
        const doc0 = previewExportDoc.cues[0];
        const seg0 = job.segments[0];
        const docText = String(doc0?.text || '').trim().toLowerCase();
        const segText = String(seg0?.text || '').trim().toLowerCase();
        if (docText && segText && docText !== segText) {
          console.warn('[export-doc-segment-mismatch]', {
            jobId: job.id,
            exportDocFirst: docText.slice(0, 80),
            segmentFirst: segText.slice(0, 80)
          });
        }
      }

      if (usePreviewBurn) {
        setSubStage(job, 'Applying cinematic layout…', 44);
        job.burnFromPreviewExportDoc = true;
        console.log('[preview-burn-source]', {
          jobId: job.id,
          exportDocCueCount: previewExportDoc.cues.length,
          firstCue: previewExportDoc.cues[0],
          lastCue: previewExportDoc.cues[previewExportDoc.cues.length - 1],
          note: 'ASS uses clean-SRT timings 1:1 (no merge, no speech shift)'
        });
        assResult = generateAssFromExportDoc(previewExportDoc, {
          ...assOpts,
          presetIdOverride: job.presetId
        });
        job.segments = (previewExportDoc.cues || []).map((c) => ({
          start: Number(c.start),
          end: Number(c.end),
          text: String(c.text || (Array.isArray(c.lines) ? c.lines.join(' ') : '')).trim()
        }));
      } else if (job.segments?.length) {
        setSubStage(job, 'Applying cinematic layout…', 44);
        assResult = generateAssContent(job.segments, job.presetId, assOpts);
      } else if (job.exportDoc) {
        assResult = generateAssFromExportDoc(job.exportDoc, {
          ...assOpts,
          presetIdOverride: job.presetId
        });
      } else {
        throw new Error('No subtitle segments provided');
      }
    assTiming.end = Date.now();

    setSubStage(job, 'Building cinematic caption layer…', 50);
    job.assPath = join(job.jobDir, 'subtitles.ass');
    const assContent = String(assResult.content || '').replace(/\r\n/g, '\n');
    await fsp.writeFile(job.assPath, assContent, 'utf8');
    const verifyContent = await fsp.readFile(job.assPath, 'utf8');
    if (verifyContent !== assContent) {
      throw new Error('ASS write verification failed');
    }
    const assStat = await fsp.stat(job.assPath);
    if (assStat.size < 200) {
      throw new Error('ASS file suspiciously small');
    }
    endExportStage(job.id, 'ass_generation');
    console.log('[ass-write-verified]', { assPath: job.assPath, size: assStat.size });

    logProductionAssDialogueDump(verifyContent, {
      jobId: job.id,
      traceId: job.traceId || null
    });

    if (job.segments?.length) {
      logExportRootCauseForensics({
        rawSegments: job.segments,
        assResult,
        presetId: job.presetId,
        captionMode: job.captionMode || 'viral',
        durationSec: probe.durationSec,
        playResX: assOpts.playResX,
        playResY: assOpts.playResY,
        positionMode: assOpts.positionMode,
        jobId: job.id,
        traceId: job.traceId || null,
        jobDir: job.jobDir
      });
        logPhraseTimingForensics({
          rawSegments: job.segments,
          assResult,
          captionMode: job.captionMode || 'viral',
          durationSec: probe.durationSec,
          minCueDurationSec:
            assResult.renderProfile?.styleMode === 'safe'
              ? 0.95
              : assResult.renderProfile?.styleMode === 'cinematic'
                ? 0.84
                : 0.74,
          jobId: job.id,
          traceId: job.traceId || null,
          jobDir: job.jobDir
        });
        logWhisperStarttimeForensics({
          exportSegments: job.segments,
          captionForensics: job.captionForensics,
          transcribeApiForensics: job.captionForensics?.transcribeApiForensics,
          segmentTimingLineage: job.captionForensics?.segmentTimingLineage,
          jobId: job.id,
          traceId: job.traceId || null,
          jobDir: job.jobDir
        });
        logRtlPhraseOrderForensics({
          exportSegments: job.segments,
          translatedSegments:
            job.captionForensics?.translatedSegments || job.segments,
          assResult,
          presetId: job.presetId,
          captionMode: job.captionMode || 'viral',
          jobId: job.id,
          traceId: job.traceId || null,
          jobDir: job.jobDir
        });
        logCaptionPositionForensics({
          segments: job.segments,
          assResult,
          presetId: job.presetId,
          captionMode: job.captionMode || 'viral',
          durationSec: probe.durationSec,
          playResX: assOpts.playResX,
          playResY: assOpts.playResY,
          positionMode: assOpts.positionMode,
          minCueDurationSec:
            assResult.renderProfile?.styleMode === 'safe'
              ? 0.95
              : assResult.renderProfile?.styleMode === 'cinematic'
                ? 0.84
                : 0.74,
          jobId: job.id,
          traceId: job.traceId || null,
          jobDir: job.jobDir
        });
        logLineLayoutForensics({
          segments: job.segments,
          assResult,
          presetId: job.presetId,
          captionMode: job.captionMode || 'viral',
          durationSec: probe.durationSec,
          playResX: assOpts.playResX,
          playResY: assOpts.playResY,
          positionMode: assOpts.positionMode,
          minCueDurationSec:
            assResult.renderProfile?.styleMode === 'safe'
              ? 0.95
              : assResult.renderProfile?.styleMode === 'cinematic'
                ? 0.84
                : 0.74,
          jobId: job.id,
          traceId: job.traceId || null,
          jobDir: job.jobDir
        });
        await logFirstCaptionForensics({
          segments: job.segments,
          assResult,
          probe,
          videoPath,
          presetId: job.presetId,
          captionMode: job.captionMode || 'viral',
          durationSec: probe.durationSec,
          captionForensics: job.captionForensics,
          minCueDurationSec:
            assResult.renderProfile?.styleMode === 'safe'
              ? 0.95
              : assResult.renderProfile?.styleMode === 'cinematic'
                ? 0.84
                : 0.74,
          jobId: job.id,
          traceId: job.traceId || null,
          jobDir: job.jobDir
        });
      }

      const assDebugPath = join(job.jobDir, 'subtitles.final.ass');
      await fsp.writeFile(assDebugPath, verifyContent, 'utf8');
      job.assDebugPath = assDebugPath;
      const assDebug = extractAssDebugInfo(verifyContent);
    job.assDebug = assDebug;

    const assDialoguesPreview = parseAssDialogueTimes(job.assPath, 3);
    traceRenderTimeline(timelineTrace, 'ass_written', {
      assPath: job.assPath,
      assGeneratorOutput: true,
      segmentSourceTiming: summarizeSegmentTiming(job.segments),
      assFirstDialogue: assDialoguesPreview[0] || null,
      hardSyncTestWillApply: isHardSyncTestEnabled()
    });

    job.renderProfile = assResult.renderProfile?.id || null;
    const adaptiveSafeguards = Boolean(assResult.renderProfile?.safeguardsActive);
    job.adaptiveSafeguards = adaptiveSafeguards;

    if (job.cancelled) return;

    job.renderStartedAt = Date.now();
    setStage(job, 'rendering', {
      stageLabel: 'Rendering',
      subStageLabel: 'Encoding TikTok-ready MP4…',
      progress: 52
    });

    const outputPath = join(job.jobDir, 'export.mp4');
    job.ffmpegAbort = new AbortController();
    startRenderHeartbeat(job, probe.durationSec);
    ffmpegStartedAt.at = Date.now();

    try {
      job.rawVideoPath = videoPath;
      const burnDurationSec = probe.durationSec;

      const onBurnProgress = (info) => {
        const pct = Number(info?.pct || 0);
        if (typeof info?.speed === 'number' && Number.isFinite(info.speed) && info.speed > 0) {
          ffmpegStats.speedSum += info.speed;
          ffmpegStats.speedSamples += 1;
          job.renderSpeedX = Number(info.speed.toFixed(2));
        }
        if (typeof info?.fps === 'number' && Number.isFinite(info.fps) && info.fps >= 0) {
          ffmpegStats.fpsSum += info.fps;
          ffmpegStats.fpsSamples += 1;
          job.renderFps = Number(info.fps.toFixed(1));
        }
        if ((info?.phase === 'muxing' || pct >= 97) && job.stageKey !== 'muxing') {
          setStage(job, 'muxing', {
            stageLabel: 'Muxing',
            subStageLabel: 'Muxing audio and video…',
            progress: 93
          });
        }

        const mapped =
          info?.phase === 'muxing'
            ? Math.min(97, 93 + Math.round(pct * 0.04))
            : Math.min(92, 52 + Math.round(pct * 0.4));
        bumpProgress(job, mapped);

        if (typeof info?.etaSec === 'number' && Number.isFinite(info.etaSec)) {
          job.etaSec = Math.max(1, Math.round(info.etaSec));
        } else if (probe.durationSec > 0 && pct > 0) {
          job.etaSec = Math.max(2, Math.round(((100 - pct) / 100) * probe.durationSec * 0.8));
        }

        if (info?.phase === 'rendering') {
          job.ffmpegMsgIndex = (job.ffmpegMsgIndex + 1) % FFMPEG_STATUS_LINES.length;
          job.subStageLabel = pct < 55 ? 'Encoding TikTok-ready MP4…' : FFMPEG_STATUS_LINES[job.ffmpegMsgIndex];
        } else if (info?.phase === 'muxing') {
          job.subStageLabel = 'Muxing audio and video…';
        }
      };

      let burnResult = null;
      let normResult = { skipped: true };

      beginExportStage(job.id, 'subtitle_burn_export');
      if (isGpuRenderEnabled()) {
        setSubStage(job, 'Encoding on GPU worker…', 55);
        purgeExpiredGpuArtifacts();
        const artifacts = registerGpuRenderArtifacts(job, videoPath);
        console.log('[gpu-render] dispatch', {
          jobId: job.id,
          preset: job.presetId,
          videoUrl: artifacts.videoUrl.slice(0, 80) + '…'
        });
        const gpuResult = await dispatchGpuRenderJob({
          jobId: job.id,
          videoUrl: artifacts.videoUrl,
          subtitleUrl: artifacts.subtitleUrl,
          preset: job.presetId,
          quality: job.quality,
          durationSec: burnDurationSec,
          trustPreviewTimings: Boolean(job.burnFromPreviewExportDoc),
          renderHints: {
            hqSafeguards,
            isVertical,
            sourceWidth: probe.width,
            sourceHeight: probe.height
          }
        });
        await downloadGpuRenderOutput(gpuResult.outputUrl, outputPath);
        job.gpuRenderMs = gpuResult.renderMs;
        job.burnAssPath = resolve(job.assPath);
        job.exportAssPath = join(job.jobDir, 'export.ass');
        copyFileSync(job.assPath, job.exportAssPath);
        console.log('[gpu-render] complete', {
          jobId: job.id,
          renderMs: gpuResult.renderMs,
          outputUrl: gpuResult.outputUrl
        });
      } else {
        setSubStage(job, 'Encoding with synced subtitles…', 51);
        const phase = await executeBurnExportPhase({
          jobId: job.id,
          jobDir: job.jobDir,
          videoPath,
          assPath: job.assPath,
          outputPath,
          quality: job.quality,
          probe,
          segments: job.segments,
          assResult,
          renderGeometry,
          hqSafeguards,
          isVertical,
          trustPreviewTimings: Boolean(job.burnFromPreviewExportDoc),
          burnFromPreviewExportDoc: Boolean(job.burnFromPreviewExportDoc),
          timelineTrace,
          signal: job.ffmpegAbort.signal,
          onProgress: onBurnProgress
        });
        burnResult = phase.burnResult;
        normResult = phase.normResult;
        job.burnAssPath = phase.burnAssPath;
        job.exportAssPath = phase.exportAssPath;
        job.ffmpegCommandExact = burnResult?.ffmpegCommandExact || null;
        job.ffmpegCwd = burnResult?.ffmpegCwd || null;
        console.log('[export-ass-preserved]', {
          exportMp4: resolve(outputPath),
          exportAss: job.exportAssPath,
          burnAssPath: job.burnAssPath,
          generatorAssPath: resolve(job.assPath),
          ffmpegCwd: job.ffmpegCwd,
          ffmpegCommand: job.ffmpegCommandExact
        });
      }
      endExportStage(job.id, 'subtitle_burn_export');

      job.timelinePlan = burnResult?.timelinePlan || null;
      job.finalRenderSyncReport = burnResult?.finalRenderSyncReport || null;
      job.normalizeResult = normResult;

    } finally {
      stopRenderHeartbeat(job);
      job.ffmpegAbort = null;
    }

    if (job.cancelled) return;

    await recordFileStage(timelineTrace, outputPath, 'post_burn_export');

    beginExportStage(job.id, 'upload_final_mp4');
    setStage(job, 'finalizing', {
      stageLabel: 'Finalizing',
      subStageLabel: 'Packaging your viral clip…',
      progress: 98
    });

    job.outputPath = outputPath;
    job.outputFilename = `cutup-${job.presetId}-${job.quality}.mp4`;

    const fileStat = statSync(outputPath);
    job.fileSizeBytes = fileStat.size;
    job.resolution = `${renderGeometry.outputWidth}×${renderGeometry.outputHeight}`;
    job.videoDurationSec = Math.round(probe.durationSec * 10) / 10;
    const renderStartAt = job.processingStartedAt || job.renderStartedAt || Date.now();
    job.renderDurationSec = Math.max(1, Math.round((Date.now() - renderStartAt) / 1000));
    const assGenerationMs =
      assTiming.start && assTiming.end && assTiming.end >= assTiming.start ? Math.max(1, assTiming.end - assTiming.start) : 0;
    const ffmpegMs = ffmpegStartedAt.at ? Math.max(1, Date.now() - ffmpegStartedAt.at) : 0;
    const totalMs = Math.max(1, Date.now() - queueStartedAt);
    const avgSpeedX =
      ffmpegStats.speedSamples > 0 ? Number((ffmpegStats.speedSum / ffmpegStats.speedSamples).toFixed(3)) : null;
    const avgFps = ffmpegStats.fpsSamples > 0 ? Number((ffmpegStats.fpsSum / ffmpegStats.fpsSamples).toFixed(2)) : null;
    const diagnostics = summarizeDiagnostics(
      job,
      probe,
      assResult,
      {
        totalMs,
        assGenerationMs,
        ffmpegMs,
        queueWaitSec: job.queueWaitSec || Math.round((job.renderStartedAt - queueStartedAt) / 1000),
        memStart,
        memEnd: memorySnapshotMb()
      },
      {
        avgSpeedX,
        avgFps,
        samples: { speed: ffmpegStats.speedSamples, fps: ffmpegStats.fpsSamples }
      }
    );
    diagnostics.assDebug = job.assDebug || null;
    diagnostics.assDebugPath = job.assDebugPath || null;
    diagnostics.exportAssPath = job.exportAssPath || null;
    diagnostics.burnAssPath = job.burnAssPath || null;
    diagnostics.generatorAssPath = job.assPath ? resolve(job.assPath) : null;
    diagnostics.ffmpegCommandExact = job.ffmpegCommandExact || null;
    diagnostics.ffmpegCwd = job.ffmpegCwd || null;
    diagnostics.timelineTrace = {
      stageCount: timelineTrace.stages.length,
      files: Object.keys(timelineTrace.files),
      finalRenderSyncReport: job.finalRenderSyncReport || null,
      timelinePlan: job.timelinePlan || null,
      normalizeResult: job.normalizeResult
        ? {
            skipped: job.normalizeResult.skipped,
            cfrFps: job.normalizeResult.cfrFps,
            durationDeltaSec: job.normalizeResult.durationDeltaSec,
            sourceIsVfr: job.normalizeResult.sourceTiming?.isVfr
          }
        : null
    };
    job.diagnostics = diagnostics;
    job.diagnosticsPath = join(job.jobDir, 'render-diagnostics.json');
    writeFileSync(job.diagnosticsPath, JSON.stringify(diagnostics, null, 2), 'utf8');
    recordRenderStat({
      quality: job.quality,
      renderSec: job.renderDurationSec
    });

    setStage(job, 'ready_to_download', {
      stageLabel: 'Ready to download',
      subStageLabel: 'Your viral clip is ready',
      progress: 100,
      etaSec: 0
    });
    endExportStage(job.id, 'upload_final_mp4');

  } catch (err) {
    stopRenderHeartbeat(job);
    job.error = toSafeRenderError(err);
    setStage(job, 'failed', { stageLabel: 'Export failed', progress: 0 });
    try {
      if (job.jobDir) {
        const failureDiagnostics = {
          jobId: job.id,
          quality: job.quality,
          styleMode: job.styleMode,
          status: 'failed',
          error: err?.message || String(err),
          safeError: job.error,
          stage: job.stageKey,
          memory: memorySnapshotMb(),
          createdAt: new Date(job.createdAt).toISOString(),
          failedAt: new Date().toISOString()
        };
        job.diagnosticsPath = join(job.jobDir, 'render-diagnostics.json');
        writeFileSync(job.diagnosticsPath, JSON.stringify(failureDiagnostics, null, 2), 'utf8');
        job.diagnostics = failureDiagnostics;
      }
    } catch {
      /* noop diagnostics failure */
    }
    console.error('[video-render] failed', {
      jobId: job.id,
      message: err?.message || String(err)
    });
    throw err;
  } finally {
    printExportStageTimings(job.id);
    trackExportEnd(job.id);
  }
}

export function purgeStaleJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt < JOB_TTL_MS) continue;
    cleanupJobArtifacts(job);
    jobs.delete(id);
  }
}

setInterval(purgeStaleJobs, 5 * 60 * 1000).unref?.();

export function getQueueStats() {
  return {
    active: activeCount,
    queued: waitQueue.length,
    total: jobs.size,
    maxConcurrent: MAX_CONCURRENT,
    avgRenderSecFast: Math.round(averageRenderSec('fast')),
    avgRenderSecHq: Math.round(averageRenderSec('hq'))
  };
}
