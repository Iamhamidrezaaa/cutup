/**
 * Short-lived artifact URLs so the RunPod worker can download source video + ASS.
 */
import { randomBytes } from 'crypto';
import { existsSync, createReadStream, statSync } from 'fs';

const registry = new Map();

function artifactTtlMs() {
  return Number(process.env.GPU_RENDER_ARTIFACT_TTL_MS || 60 * 60 * 1000);
}

export function resolveGpuArtifactPublicBase() {
  const base =
    process.env.GPU_RENDER_ARTIFACT_BASE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    'https://cutup.shop';
  return String(base).replace(/\/$/, '');
}

/**
 * @param {object} job
 * @param {string} videoPath
 * @returns {{ token: string, videoUrl: string, subtitleUrl: string }}
 */
export function registerGpuRenderArtifacts(job, videoPath) {
  if (!job?.id || !job?.assPath || !videoPath) {
    throw new Error('GPU_ARTIFACT_REGISTRATION_INCOMPLETE');
  }
  if (!existsSync(videoPath) || !existsSync(job.assPath)) {
    throw new Error('GPU_ARTIFACT_FILES_MISSING');
  }

  const token = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + artifactTtlMs();
  registry.set(token, {
    jobId: job.id,
    videoPath,
    assPath: job.assPath,
    expiresAt
  });

  const base = resolveGpuArtifactPublicBase();
  const q = (kind) =>
    `${base}/api/export-video?action=gpu-artifact&jobId=${encodeURIComponent(job.id)}&kind=${kind}&token=${encodeURIComponent(token)}`;

  return {
    token,
    videoUrl: q('video'),
    subtitleUrl: q('ass')
  };
}

export function resolveGpuArtifactPath(jobId, kind, token) {
  const entry = registry.get(String(token || ''));
  if (!entry || entry.jobId !== jobId) return null;
  if (Date.now() > entry.expiresAt) {
    registry.delete(String(token));
    return null;
  }
  if (kind === 'video') return entry.videoPath;
  if (kind === 'ass') return entry.assPath;
  return null;
}

export function streamGpuArtifact(req, res, jobId, kind, token) {
  const path = resolveGpuArtifactPath(jobId, kind, token);
  if (!path || !existsSync(path)) {
    return { ok: false, status: 404 };
  }

  const stat = statSync(path);
  const isAss = kind === 'ass';
  res.setHeader('Content-Type', isAss ? 'text/plain; charset=utf-8' : 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Gpu-Artifact-Job', jobId);

  const stream = createReadStream(path);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
  return { ok: true };
}

export function purgeExpiredGpuArtifacts() {
  const now = Date.now();
  for (const [token, entry] of registry.entries()) {
    if (entry.expiresAt <= now) registry.delete(token);
  }
}
