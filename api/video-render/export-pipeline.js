/**
 * User-facing export pipeline stages (real backend mapping).
 */
export const PIPELINE_STAGES = [
  { step: 1, key: 'preparing', label: 'Preparing export' },
  { step: 2, key: 'generating_captions', label: 'Generating captions' },
  { step: 3, key: 'building_layout', label: 'Building subtitle layout' },
  { step: 4, key: 'rendering', label: 'Rendering video' },
  { step: 5, key: 'finalizing', label: 'Finalizing output' },
  { step: 6, key: 'ready', label: 'Ready to download' }
];

const STAGE_KEY_TO_STEP = {
  queued: 0,
  preparing: 1,
  preparing_source: 1,
  generating_captions: 2,
  generating_subtitles: 2,
  subtitle_layout: 3,
  rendering: 4,
  rendering_video: 4,
  muxing: 4,
  finalizing: 5,
  finalizing_export: 5,
  exporting: 5,
  ready_to_download: 6,
  completed: 6,
  failed: -1,
  cancelled: -1
};

export function resolvePipelineStep(job) {
  if (!job) return { step: 0, label: 'Waiting', key: 'queued' };
  const phase = String(job.exportPhase || job.stageKey || job.stage || 'queued');
  const step = STAGE_KEY_TO_STEP[phase] ?? STAGE_KEY_TO_STEP[job.stageKey] ?? 1;
  if (step === 6) {
    return { step: 6, label: 'Ready to download', key: 'ready' };
  }
  if (step === 0) {
    return { step: 0, label: 'Waiting in queue', key: 'queued' };
  }
  const found = PIPELINE_STAGES.find((s) => s.step === step);
  return {
    step,
    label: found?.label || job.stageLabel || 'Processing',
    key: found?.key || phase
  };
}

export function formatEtaIso(etaSec) {
  const sec = Math.max(0, Math.round(Number(etaSec) || 0));
  if (!sec) return null;
  return new Date(Date.now() + sec * 1000).toISOString();
}
