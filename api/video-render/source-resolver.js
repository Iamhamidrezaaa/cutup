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
import {
  runQueuedDownload,
  getCachedExtraction,
  setCachedExtraction
} from '../infrastructure/guards.js';
import { extractionDebug } from '../infrastructure/observability.js';

const execAsync = promisify(exec);
const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 120000);
const YTDLP_MAX_RETRIES = Math.max(1, Number(process.env.YTDLP_MAX_RETRIES || 3));
const YTDLP_BURST_WINDOW_MS = Math.max(1000, Number(process.env.YTDLP_BURST_WINDOW_MS || 5000));
const YTDLP_MIN_JITTER_MS = Math.max(50, Number(process.env.YTDLP_MIN_JITTER_MS || 150));
const YTDLP_MAX_JITTER_MS = Math.max(YTDLP_MIN_JITTER_MS + 50, Number(process.env.YTDLP_MAX_JITTER_MS || 650));
const extractionBurstState = new Map();

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

function cookiesCandidatePaths() {
  const envPath = String(process.env.YTDLP_COOKIES_PATH || '').trim();
  return [
    envPath,
    join(process.cwd(), 'cookies.txt'),
    join(process.cwd(), 'cookies', 'cookies.txt'),
    join(process.cwd(), 'cookies', 'youtube_cookies.txt')
  ].filter(Boolean);
}

function resolveCookiesPath() {
  for (const p of cookiesCandidatePaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

function classifyYtDlpFailure(stderr = '') {
  const text = String(stderr || '').toLowerCase();
  if (
    text.includes('http error 429') ||
    text.includes('too many requests') ||
    text.includes('try again later') ||
    text.includes('temporarily unavailable') ||
    text.includes('unable to download api page') ||
    text.includes('sign in to confirm') ||
    text.includes('please log in') ||
    text.includes('bot')
  ) {
    return { code: 'YTDLP_TEMP_BLOCK', userMessage: 'YouTube temporarily blocked extraction', temporary: true };
  }
  if (
    text.includes('login required') ||
    text.includes('authentication') ||
    text.includes('private video') ||
    text.includes('members-only')
  ) {
    return { code: 'YTDLP_AUTH_REQUIRED', userMessage: 'Authentication required', temporary: false };
  }
  if (
    text.includes('video unavailable') ||
    text.includes('this video is unavailable') ||
    text.includes('not available in your country') ||
    text.includes('copyright') ||
    text.includes('404')
  ) {
    return { code: 'YTDLP_VIDEO_UNAVAILABLE', userMessage: 'Video unavailable', temporary: false };
  }
  return { code: 'YTDLP_FAILED', userMessage: 'Could not extract video stream', temporary: false };
}

async function applyExtractionBurstDelay(key) {
  const k = String(key || 'global');
  const now = Date.now();
  const state = extractionBurstState.get(k) || { lastTs: 0 };
  const elapsed = now - state.lastTs;
  const jitter = YTDLP_MIN_JITTER_MS + Math.floor(Math.random() * Math.max(1, YTDLP_MAX_JITTER_MS - YTDLP_MIN_JITTER_MS));
  const delay = elapsed < YTDLP_BURST_WINDOW_MS ? jitter : Math.floor(jitter * 0.5);
  extractionBurstState.set(k, { lastTs: now + delay });
  await new Promise((r) => setTimeout(r, delay));
}

function buildExtractorStrategies(finalUrl, outputTemplate, cookiesPath) {
  const base = ['--no-playlist', '--no-warnings', '-f', 'bv*+ba/b[ext=mp4]/b', '--merge-output-format', 'mp4', '-o', outputTemplate];
  return [
    {
      extractor: 'yt-dlp',
      clientProfile: 'normal',
      cookiesEnabled: false,
      args: [...base, finalUrl]
    },
    {
      extractor: 'yt-dlp',
      clientProfile: 'android',
      cookiesEnabled: false,
      args: [...base, '--extractor-args', 'youtube:player_client=android', finalUrl]
    },
    {
      extractor: 'yt-dlp',
      clientProfile: 'tv_embedded',
      cookiesEnabled: false,
      args: [...base, '--extractor-args', 'youtube:player_client=tv_embedded', finalUrl]
    },
    {
      extractor: 'yt-dlp',
      clientProfile: 'cookies',
      cookiesEnabled: Boolean(cookiesPath),
      args: cookiesPath ? [...base, '--cookies', cookiesPath, finalUrl] : null
    }
  ].filter((s) => Array.isArray(s.args));
}

async function runYtDlpWithRetries({ ytDlpPath, strategy, jobDir, traceId }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= YTDLP_MAX_RETRIES; attempt++) {
    console.log('[ytdlp-debug]', {
      traceId: traceId || null,
      extractor: strategy.extractor,
      clientProfile: strategy.clientProfile,
      retries: attempt,
      cookiesEnabled: strategy.cookiesEnabled
    });
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(ytDlpPath, strategy.args, { cwd: jobDir, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
          try {
            p.kill('SIGKILL');
          } catch {
            /* noop */
          }
          reject(Object.assign(new Error('Video download timed out'), { code: 'YTDLP_TIMEOUT', stderr }));
        }, YTDLP_TIMEOUT_MS);

        p.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        p.on('error', (err) => {
          clearTimeout(timer);
          reject(Object.assign(err, { stderr }));
        });
        p.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(Object.assign(new Error(stderr.slice(-600) || `yt-dlp exit ${code}`), { code: 'YTDLP_FAILED', stderr }));
        });
      });
      return;
    } catch (err) {
      const failure = classifyYtDlpFailure(err?.stderr || err?.message || '');
      lastErr = Object.assign(new Error(failure.userMessage), {
        code: failure.code,
        details: String(err?.message || err),
        temporary: failure.temporary
      });
      if (!failure.temporary || attempt >= YTDLP_MAX_RETRIES) break;
      const backoffMs = Math.min(4000, 350 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 220);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr || new Error('Could not extract video stream');
}

/**
 * Download video via yt-dlp into jobDir (internal; use downloadVideoFromUrl).
 * @param {{ url: string, userEmail: string, traceId?: string }} opts
 */
async function downloadVideoFromUrlCore(opts) {
  const { url, userEmail, traceId } = opts;
  const originalUrl = String(url || '');
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
  const cookiesPath = resolveCookiesPath();
  const strategies = buildExtractorStrategies(finalUrl, outputTemplate, cookiesPath);
  await applyExtractionBurstDelay(opts.requestKey || userEmail || 'anonymous');
  let selectedStrategy = null;
  let lastError = null;
  for (const strategy of strategies) {
    try {
      await runYtDlpWithRetries({ ytDlpPath, strategy, jobDir, traceId });
      selectedStrategy = strategy;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!selectedStrategy) {
    throw lastError || Object.assign(new Error('YouTube temporarily blocked extraction'), { code: 'YTDLP_TEMP_BLOCK' });
  }

  const file = findMediaFile(jobDir);
  if (!file) {
    throw Object.assign(new Error('Downloaded video file not found'), { code: 'VIDEO_NOT_FOUND' });
  }

  console.log('[ytdlp-debug]', {
    traceId: traceId || null,
    extractor: selectedStrategy.extractor,
    clientProfile: selectedStrategy.clientProfile,
    retries: YTDLP_MAX_RETRIES,
    cookiesEnabled: selectedStrategy.cookiesEnabled,
    finalSelectedStream: 'bv*+ba/b[ext=mp4]/b'
  });

  return {
    videoPath: file,
    jobDir,
    platform: detectedPlatform,
    url: finalUrl,
    originalUrl,
    urlNormalized: String(originalUrl) !== String(finalUrl),
    downloadSlotConsumed: true
  };
}

/**
 * Download video via yt-dlp into jobDir (queued + URL cache).
 * @param {{ url: string, userEmail: string, traceId?: string }} opts
 */
export async function downloadVideoFromUrl(opts) {
  const { url, traceId } = opts;
  const cached = getCachedExtraction(url, traceId);
  if (cached?.videoPath && existsSync(cached.videoPath)) {
    extractionDebug(traceId, {
      phase: 'cache_hit',
      cacheStage: 'video',
      normalizedUrl: cached.key,
      reusedAssets: ['videoPath']
    });
    return {
      videoPath: cached.videoPath,
      jobDir: cached.jobDir,
      platform: cached.metadata?.platform || null,
      url: cached.key || url,
      originalUrl: url,
      urlNormalized: true,
      downloadSlotConsumed: false,
      fromCache: true
    };
  }

  return runQueuedDownload({
    url,
    userEmail: opts.userEmail,
    traceId,
    fn: async () => {
      const result = await downloadVideoFromUrlCore(opts);
      setCachedExtraction(result.url || url, {
        stage: 'video',
        videoPath: result.videoPath,
        jobDir: result.jobDir,
        metadata: { platform: result.platform },
        reusedAssets: ['videoPath']
      }, traceId);
      return result;
    }
  });
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
