/**
 * Resolve source video for burn-in: local path, multipart upload, or yt-dlp fetch.
 */
import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectPlatformFromUrl,
  validateMediaUrl,
  parseYouTubeVideoId,
  normalizeYouTubeWatchUrl,
  stripTrackingQueryParams,
  normalizeInstagramUrl
} from '../media-url.js';
import { consumeDownloadSlotAtomic } from '../billing-repository.js';

const execAsync = promisify(exec);
const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 120000);

function findMediaFile(dir) {
  const exts = ['.mp4', '.webm', '.mkv', '.mov', '.m4v'];
  for (const name of readdirSync(dir)) {
    const lower = name.toLowerCase();
    if (exts.some((e) => lower.endsWith(e))) {
      const full = join(dir, name);
      if (statSync(full).isFile()) return full;
    }
  }
  return null;
}

async function resolveYtDlpPath() {
  try {
    const { stdout } = await execAsync('which yt-dlp');
    if (stdout.trim()) return stdout.trim();
  } catch {
    /* try where on windows */
  }
  try {
    const { stdout } = await execAsync('where yt-dlp');
    const line = stdout.split(/\r?\n/).find(Boolean)?.trim();
    if (line) return line;
  } catch {
    /* noop */
  }
  return 'yt-dlp';
}

/**
 * Download video via yt-dlp into jobDir.
 * @param {{ url: string, userEmail: string, traceId?: string }} opts
 */
export async function downloadVideoFromUrl(opts) {
  const { url, userEmail, traceId } = opts;
  const validation = validateMediaUrl(url);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.reason || 'Invalid URL'), { code: validation.code || 'INVALID_URL' });
  }

  let finalUrl = validation.normalizedUrl || stripTrackingQueryParams(url);
  let detectedPlatform = validation.platform || detectPlatformFromUrl(finalUrl);
  if (detectedPlatform === 'youtube') {
    const vid = parseYouTubeVideoId(finalUrl);
    if (vid) finalUrl = normalizeYouTubeWatchUrl(vid);
  } else if (detectedPlatform === 'instagram') {
    finalUrl = normalizeInstagramUrl(finalUrl);
  }

  const slot = await consumeDownloadSlotAtomic(userEmail, 'video', {
    platform: detectedPlatform,
    traceId: traceId || null
  });
  if (!slot.ok) {
    throw Object.assign(new Error(slot.reason || 'Download not allowed'), { code: 'LIMIT_EXCEEDED' });
  }

  const jobDir = join(tmpdir(), `cutup_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(jobDir, { recursive: true });
  const outputTemplate = join(jobDir, 'source.%(ext)s');
  const ytDlpPath = await resolveYtDlpPath();

  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bv*+ba/b[ext=mp4]/b',
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate,
    finalUrl
  ];

  await new Promise((resolve, reject) => {
    const p = spawn(ytDlpPath, args, { cwd: jobDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        /* noop */
      }
      reject(Object.assign(new Error('Video download timed out'), { code: 'YTDLP_TIMEOUT' }));
    }, YTDLP_TIMEOUT_MS);

    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    p.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(stderr.slice(-400) || `yt-dlp exit ${code}`), { code: 'YTDLP_FAILED' }));
    });
  });

  const file = findMediaFile(jobDir);
  if (!file) {
    throw Object.assign(new Error('Downloaded video file not found'), { code: 'VIDEO_NOT_FOUND' });
  }

  return { videoPath: file, jobDir, platform: detectedPlatform, url: finalUrl, downloadSlotConsumed: true };
}

/**
 * @param {{ buffer: Buffer, filename: string, jobDir: string }} opts
 */
export function saveUploadedVideo(opts) {
  const { buffer, filename, jobDir } = opts;
  mkdirSync(jobDir, { recursive: true });
  const ext = (filename.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase();
  const safeExt = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext) ? ext : '.mp4';
  const dest = join(jobDir, `upload${safeExt}`);
  writeFileSync(dest, buffer);
  return dest;
}

export function createJobDir() {
  const jobDir = join(tmpdir(), `cutup_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(jobDir, { recursive: true });
  return jobDir;
}

export function stageLocalPath(sourcePath, jobDir) {
  const dest = join(jobDir, 'source.mp4');
  copyFileSync(sourcePath, dest);
  return dest;
}
