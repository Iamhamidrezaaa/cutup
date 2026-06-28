/**
 * Resolve source video for burn-in: local path, multipart upload, or yt-dlp fetch.
 */
import { spawn } from 'child_process';
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
import {
  resolveYtDlpPath,
  resolveCookiesPath,
  classifyYtDlpError,
  applyYtdlpBurstDelay,
  buildInstagramAuthVariants,
  isInstagramAuthBlock,
  logInstagramCookiesStatus,
  resolveInstagramCookiesPath,
  runYtDlpRobust
} from '../ytdlp-robust.js';

const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 120000);
const YTDLP_MAX_RETRIES = Math.max(1, Number(process.env.YTDLP_MAX_RETRIES || 3));
const INSTAGRAM_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const INSTAGRAM_VIDEO_FORMATS = [
  'bv*+ba/b',
  'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
  'b[ext=mp4]/b',
  'b'
];

const TIKTOK_VIDEO_FORMATS = [
  'bv*+ba/b',
  'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
  'b[ext=mp4]/b',
  'b'
];

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

function buildPlatformBaseArgs(outputTemplate, platform) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificate',
    '--no-mtime',
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate
  ];
  if (platform === 'instagram') {
    args.push('--user-agent', INSTAGRAM_USER_AGENT);
    args.push('--referer', 'https://www.instagram.com/');
    args.push('--add-header', 'Origin:https://www.instagram.com');
    args.push('--sleep-requests', '1');
  }
  return args;
}

function mapYtDlpError(err, platform) {
  const failure = classifyYtDlpError(err?.stderr || err?.message || '');
  let userMessage = failure.message || 'Could not extract video stream';
  if (failure.code === 'YTDLP_AUTH_REQUIRED' && platform === 'instagram') {
    userMessage = resolveInstagramCookiesPath()
      ? 'Instagram blocked video download. Try again in a minute or re-paste the Reel link.'
      : 'Instagram export is temporarily unavailable on the server. Our team is fixing cookie auth.';
  } else if (failure.code === 'YTDLP_AUTH_REQUIRED') {
    userMessage = 'Authentication required to download this video for export.';
  }
  return Object.assign(new Error(userMessage), {
    code: failure.code,
    details: String(err?.message || err),
    temporary: failure.temporary,
    stderr: err?.stderr || ''
  });
}

async function spawnYtDlpDownload({ ytDlpPath, args, jobDir, traceId, platform }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= YTDLP_MAX_RETRIES; attempt++) {
    console.log('[ytdlp-debug]', {
      traceId: traceId || null,
      platform,
      retries: attempt,
      cookiesEnabled: args.includes('--cookies') || args.includes('--cookies-from-browser')
    });
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(ytDlpPath, args, { cwd: jobDir, stdio: ['ignore', 'pipe', 'pipe'] });
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
          else {
            reject(
              Object.assign(new Error(stderr.slice(-600) || `yt-dlp exit ${code}`), {
                code: 'YTDLP_FAILED',
                stderr
              })
            );
          }
        });
      });
      return;
    } catch (err) {
      lastErr = mapYtDlpError(err, platform);
      if (!lastErr.temporary || attempt >= YTDLP_MAX_RETRIES) break;
      const backoffMs = Math.min(4000, 350 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 220);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr || new Error('Could not extract video stream');
}

async function downloadInstagramVideo({ ytDlpPath, finalUrl, jobDir, outputTemplate, traceId }) {
  logInstagramCookiesStatus();
  const authVariants = buildInstagramAuthVariants();
  let lastErr = null;
  for (const auth of authVariants) {
    for (let i = 0; i < INSTAGRAM_VIDEO_FORMATS.length; i++) {
      const format = INSTAGRAM_VIDEO_FORMATS[i];
      try {
        const args = [
          ...buildPlatformBaseArgs(outputTemplate, 'instagram'),
          '-f',
          format,
          ...auth.extraArgs,
          finalUrl
        ];
        await spawnYtDlpDownload({ ytDlpPath, args, jobDir, traceId, platform: 'instagram' });
        return { clientProfile: auth.label, selectedFormat: format };
      } catch (err) {
        lastErr = err;
        const stderr = String(err?.stderr || err?.message || '');
        const formatUnavailable =
          stderr.includes('Requested format is not available') ||
          stderr.includes('format is not available');
        if (formatUnavailable && i < INSTAGRAM_VIDEO_FORMATS.length - 1) continue;
        if (isInstagramAuthBlock(stderr) && auth !== authVariants[authVariants.length - 1]) break;
      }
    }
  }
  throw lastErr || mapYtDlpError(new Error('No available formats found for Instagram URL'), 'instagram');
}

async function downloadTiktokVideo({ ytDlpPath, finalUrl, jobDir, outputTemplate, traceId }) {
  let lastErr = null;
  for (let i = 0; i < TIKTOK_VIDEO_FORMATS.length; i++) {
    const format = TIKTOK_VIDEO_FORMATS[i];
    try {
      const args = [...buildPlatformBaseArgs(outputTemplate, 'tiktok'), '-f', format, finalUrl];
      await spawnYtDlpDownload({ ytDlpPath, args, jobDir, traceId, platform: 'tiktok' });
      return { clientProfile: 'tiktok_fallback', selectedFormat: format };
    } catch (err) {
      lastErr = err;
      const stderr = String(err?.stderr || err?.message || '');
      if (
        (stderr.includes('Requested format is not available') ||
          stderr.includes('format is not available')) &&
        i < TIKTOK_VIDEO_FORMATS.length - 1
      ) {
        continue;
      }
    }
  }
  throw lastErr || mapYtDlpError(new Error('No available formats found for TikTok URL'), 'tiktok');
}

async function downloadYoutubeVideo({ ytDlpPath, finalUrl, jobDir, outputTemplate, traceId, cookiesPath }) {
  const baseArgs = buildPlatformBaseArgs(outputTemplate, 'youtube');
  try {
    await runYtDlpRobust({
      ytDlpPath,
      baseArgs,
      url: finalUrl,
      cwd: jobDir,
      traceId,
      mode: 'download',
      formatFallbacks: [
        'bv*+ba/b[ext=mp4]/b',
        'bestvideo+bestaudio/best',
        'best',
        'mp4',
        'b'
      ]
    });
    return { clientProfile: 'robust_youtube', selectedFormat: 'bv*+ba/b[ext=mp4]/b' };
  } catch (err) {
    const strategies = [
      {
        clientProfile: 'android',
        args: [
          ...baseArgs,
          '-f',
          'bv*+ba/b[ext=mp4]/b',
          '--extractor-args',
          'youtube:player_client=android',
          finalUrl
        ]
      },
      {
        clientProfile: 'cookies',
        args: cookiesPath
          ? [...baseArgs, '-f', 'bv*+ba/b[ext=mp4]/b', '--cookies', cookiesPath, finalUrl]
          : null
      }
    ].filter((s) => Array.isArray(s.args));

    let lastErr = mapYtDlpError(err, 'youtube');
    for (const strategy of strategies) {
      try {
        await spawnYtDlpDownload({
          ytDlpPath,
          args: strategy.args,
          jobDir,
          traceId,
          platform: 'youtube'
        });
        return strategy;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }
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
  await applyYtdlpBurstDelay(opts.requestKey || userEmail || 'anonymous');

  let selectedStrategy = null;
  if (detectedPlatform === 'instagram') {
    selectedStrategy = await downloadInstagramVideo({ ytDlpPath, finalUrl, jobDir, outputTemplate, traceId });
  } else if (detectedPlatform === 'tiktok') {
    selectedStrategy = await downloadTiktokVideo({ ytDlpPath, finalUrl, jobDir, outputTemplate, traceId });
  } else {
    selectedStrategy = await downloadYoutubeVideo({
      ytDlpPath,
      finalUrl,
      jobDir,
      outputTemplate,
      traceId,
      cookiesPath
    });
  }

  const file = findMediaFile(jobDir);
  if (!file) {
    throw Object.assign(new Error('Downloaded video file not found'), { code: 'VIDEO_NOT_FOUND' });
  }

  console.log('[ytdlp-debug]', {
    traceId: traceId || null,
    platform: detectedPlatform,
    clientProfile: selectedStrategy?.clientProfile,
    selectedFormat: selectedStrategy?.selectedFormat,
    cookiesEnabled: Boolean(resolveInstagramCookiesPath() || cookiesPath)
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
