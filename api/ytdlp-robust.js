import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseYouTubeVideoId, normalizeYouTubeWatchUrl } from './media-url.js';

const execAsync = promisify(exec);
const YTDLP_TIMEOUT_MS = Math.max(10000, Number(process.env.YTDLP_TIMEOUT_MS || 120000));
const YTDLP_MAX_RETRIES = Math.max(1, Number(process.env.YTDLP_MAX_RETRIES || 3));
const YTDLP_BURST_WINDOW_MS = Math.max(1000, Number(process.env.YTDLP_BURST_WINDOW_MS || 5000));
const YTDLP_MIN_JITTER_MS = Math.max(50, Number(process.env.YTDLP_MIN_JITTER_MS || 120));
const YTDLP_MAX_JITTER_MS = Math.max(YTDLP_MIN_JITTER_MS + 50, Number(process.env.YTDLP_MAX_JITTER_MS || 650));
const extractionBurstState = new Map();
let cachedYtdlpVersion = null;

function isDebugEnabled() {
  return String(process.env.YTDLP_DEBUG || '').toLowerCase() === 'true';
}

function logYtdlp(tag, payload) {
  if (!isDebugEnabled() && tag !== '[ytdlp-debug]') return;
  console.log(tag, payload);
}

export async function resolveYtDlpPath() {
  try {
    const { stdout } = await execAsync('which yt-dlp');
    if (stdout.trim()) return stdout.trim();
  } catch {
    /* noop */
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

export function resolveCookiesPath() {
  const envPath = String(process.env.YTDLP_COOKIES_PATH || '').trim();
  const candidates = [
    envPath,
    join(process.cwd(), 'cookies.txt'),
    join(process.cwd(), 'cookies', 'cookies.txt'),
    join(process.cwd(), 'cookies', 'youtube_cookies.txt')
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function classifyYtDlpError(stderr = '') {
  const text = String(stderr || '').toLowerCase();
  if (
    text.includes('http error 429') ||
    text.includes('too many requests') ||
    text.includes('try again later') ||
    text.includes('temporarily unavailable') ||
    text.includes('unable to download api page') ||
    text.includes('sign in to confirm') ||
    text.includes('bot')
  ) {
    return { code: 'YTDLP_TEMP_BLOCK', message: 'YouTube temporarily blocked extraction', temporary: true };
  }
  if (
    text.includes('login required') ||
    text.includes('authentication') ||
    text.includes('private video') ||
    text.includes('members-only')
  ) {
    return { code: 'YTDLP_AUTH_REQUIRED', message: 'Authentication required', temporary: false };
  }
  if (
    text.includes('cookies') && text.includes('invalid')
  ) {
    return { code: 'YTDLP_COOKIES_INVALID', message: 'Cookies invalid', temporary: false };
  }
  if (
    text.includes('requested format is not available') ||
    text.includes('no video formats') ||
    text.includes('no suitable formats')
  ) {
    return { code: 'YTDLP_NO_FORMATS', message: 'No formats found', temporary: false };
  }
  if (
    text.includes('video unavailable') ||
    text.includes('this video is unavailable') ||
    text.includes('not available in your country') ||
    text.includes('copyright')
  ) {
    return { code: 'YTDLP_VIDEO_UNAVAILABLE', message: 'Video unavailable', temporary: false };
  }
  return { code: 'YTDLP_FAILED', message: 'Could not extract video stream', temporary: false };
}

export async function applyYtdlpBurstDelay(key) {
  const k = String(key || 'global');
  const now = Date.now();
  const state = extractionBurstState.get(k) || { lastTs: 0 };
  const elapsed = now - state.lastTs;
  const jitter = YTDLP_MIN_JITTER_MS + Math.floor(Math.random() * Math.max(1, YTDLP_MAX_JITTER_MS - YTDLP_MIN_JITTER_MS));
  const delay = elapsed < YTDLP_BURST_WINDOW_MS ? jitter : Math.floor(jitter * 0.5);
  extractionBurstState.set(k, { lastTs: now + delay });
  await new Promise((r) => setTimeout(r, delay));
}

function buildStrategyArgs(baseArgs, url, cookiesPath) {
  return [
    { profile: 'normal', cookiesEnabled: false, args: [...baseArgs, url] },
    { profile: 'android', cookiesEnabled: false, args: [...baseArgs, '--extractor-args', 'youtube:player_client=android', url] },
    { profile: 'tv_embedded', cookiesEnabled: false, args: [...baseArgs, '--extractor-args', 'youtube:player_client=tv_embedded', url] },
    ...(cookiesPath ? [{ profile: 'cookies', cookiesEnabled: true, args: [...baseArgs, '--cookies', cookiesPath, url] }] : [])
  ];
}

function normalizeYoutubeUrlIfShorts(url) {
  const raw = String(url || '');
  const isShorts = /youtube\.com\/shorts\//i.test(raw);
  if (!isShorts) return { normalizedUrl: raw, urlNormalized: false, isShorts: false };
  const id = parseYouTubeVideoId(raw);
  if (!id) return { normalizedUrl: raw, urlNormalized: false, isShorts: true };
  return { normalizedUrl: normalizeYouTubeWatchUrl(id) || raw, urlNormalized: true, isShorts: true };
}

function stripFormatArgs(args = []) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '--format') {
      i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

async function resolveYtdlpVersion(ytDlpPath) {
  if (cachedYtdlpVersion) return cachedYtdlpVersion;
  try {
    const { stdout } = await runOne(ytDlpPath, ['--version']);
    cachedYtdlpVersion = String(stdout || '').trim() || 'unknown';
  } catch {
    cachedYtdlpVersion = 'unknown';
  }
  return cachedYtdlpVersion;
}

async function probeFormatsCount(ytDlpPath, url, cwd) {
  try {
    const { stdout } = await runOne(ytDlpPath, ['--list-formats', '--no-playlist', url], cwd);
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const formats = lines.filter((l) => /^\d{2,}|\w{2,}\s+\w{2,}/.test(l));
    return formats.length;
  } catch {
    return null;
  }
}

async function runOne(ytDlpPath, args, cwd) {
  return await new Promise((resolve, reject) => {
    const p = spawn(ytDlpPath, args, { cwd: cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        /* noop */
      }
      reject(Object.assign(new Error('yt-dlp timeout'), { code: 'YTDLP_TIMEOUT', stdout, stderr }));
    }, YTDLP_TIMEOUT_MS);

    p.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    p.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { stdout, stderr }));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(stderr.slice(-600) || `yt-dlp exit ${code}`), { code: 'YTDLP_FAILED', stdout, stderr }));
    });
  });
}

export async function runYtDlpRobust(opts) {
  const {
    ytDlpPath,
    baseArgs,
    url,
    cwd,
    requestKey,
    traceId,
    mode = 'extract',
    formatFallbacks = null,
    proxyProvider = null // future proxy rotation hook
  } = opts;
  void proxyProvider;
  const normalization = normalizeYoutubeUrlIfShorts(url);
  const normalizedUrl = normalization.normalizedUrl;
  const cookiesPath = resolveCookiesPath();
  const baseNoFormat = stripFormatArgs(baseArgs);
  const resolvedFormatFallbacks =
    Array.isArray(formatFallbacks) && formatFallbacks.length
      ? formatFallbacks
      : ['bestvideo+bestaudio', 'best', 'mp4', 'worst'];
  const effectiveFormatFallbacks =
    mode === 'extract' ? resolvedFormatFallbacks : [null];
  const strategies = buildStrategyArgs(baseNoFormat, normalizedUrl, cookiesPath);
  if (normalization.isShorts) {
    strategies.sort((a, b) => (a.profile === 'android' ? -1 : b.profile === 'android' ? 1 : 0));
  }
  await applyYtdlpBurstDelay(requestKey);
  const version = await resolveYtdlpVersion(ytDlpPath);
  logYtdlp('[ytdlp-version-debug]', { version, path: ytDlpPath });
  const availableFormatsCount = mode === 'extract' ? await probeFormatsCount(ytDlpPath, normalizedUrl, cwd) : null;

  let lastErr = null;
  for (const fmt of effectiveFormatFallbacks) {
    for (const strategy of strategies) {
      for (let attempt = 1; attempt <= YTDLP_MAX_RETRIES; attempt++) {
        const args = fmt ? [...strategy.args, '-f', fmt] : [...strategy.args];
        logYtdlp('[ytdlp-debug]', {
          traceId: traceId || null,
          extractor: 'yt-dlp',
          clientProfile: strategy.profile,
          retries: attempt,
          cookiesEnabled: strategy.cookiesEnabled,
          mode,
          selectedFormat: fmt || '(n/a)'
        });
        try {
          const result = await runOne(ytDlpPath, args, cwd);
          logYtdlp('[ytdlp-stream-debug]', {
            traceId: traceId || null,
            availableFormatsCount,
            selectedFormat: fmt || '(n/a)',
            extractor: 'yt-dlp',
            playerClient: strategy.profile,
            cookiesEnabled: strategy.cookiesEnabled,
            urlNormalized: normalization.urlNormalized
          });
          return { ...result, strategy, selectedFormat: fmt || null, normalizedUrl };
        } catch (err) {
          const mapped = classifyYtDlpError(err?.stderr || err?.message || '');
          lastErr = Object.assign(new Error(mapped.message), {
            code: mapped.code,
            temporary: mapped.temporary,
            stdout: err?.stdout || '',
            stderr: err?.stderr || '',
            selectedFormat: fmt || null
          });
          if (!mapped.temporary || attempt >= YTDLP_MAX_RETRIES) break;
          const backoffMs = Math.min(4000, 320 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 220);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }
  }
  throw lastErr || new Error('Could not extract video stream');
}
