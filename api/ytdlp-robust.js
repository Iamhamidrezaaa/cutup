import { spawnWithTimeout } from './infrastructure/gpu-guard.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { parseYouTubeVideoId, normalizeYouTubeWatchUrl } from './media-url.js';

const __apiDir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__apiDir, '..');
let materializedInstagramCookiesPath = null;

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

export function logYoutubeCookiesStatus() {
  const filePath = resolveCookiesPath();
  const browser = String(process.env.YTDLP_COOKIES_FROM_BROWSER || process.env.YOUTUBE_COOKIES_BROWSER || '').trim();
  if (filePath) {
    console.log(`[youtube-cookies] file ready (${filePath})`);
    return { ok: true, mode: 'file', path: filePath };
  }
  if (browser) {
    console.log(`[youtube-cookies] browser export enabled (${browser})`);
    return { ok: true, mode: 'browser', path: browser };
  }
  console.warn(
    '[youtube-cookies] NOT configured — export cookies/youtube_cookies.txt or set YTDLP_COOKIES_FROM_BROWSER when YouTube blocks extraction'
  );
  return { ok: false, mode: null, path: null };
}

function cookieFileCandidates(name) {
  return [
    join(PROJECT_ROOT, 'cookies', name),
    join(process.cwd(), 'cookies', name),
    join('/var/www/cutup/cookies', name),
    join('/var/www/cutup', 'cookies', name)
  ];
}

function normalizeCookieFileContent(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trimEnd();
}

/** Write cookies from INSTAGRAM_COOKIES_BASE64 env to a temp file (for VPS / PM2). */
export function materializeInstagramCookiesFromEnv() {
  const b64 = String(process.env.INSTAGRAM_COOKIES_BASE64 || '').trim();
  if (!b64) return null;
  try {
    const content = normalizeCookieFileContent(Buffer.from(b64, 'base64').toString('utf8'));
    if (!content.includes('instagram.com') || !content.includes('sessionid')) {
      console.error('[instagram-cookies] INSTAGRAM_COOKIES_BASE64 missing instagram.com sessionid');
      return null;
    }
    const dir = join(tmpdir(), 'cutup-cookies');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'instagram_cookies.txt');
    writeFileSync(path, `${content}\n`, 'utf8');
    materializedInstagramCookiesPath = path;
    return path;
  } catch (e) {
    console.error('[instagram-cookies] materialize failed:', e?.message || e);
    return null;
  }
}

export function resolveInstagramCookiesPath() {
  if (materializedInstagramCookiesPath && existsSync(materializedInstagramCookiesPath)) {
    return materializedInstagramCookiesPath;
  }

  const fromEnvBlob = materializeInstagramCookiesFromEnv();
  if (fromEnvBlob) return fromEnvBlob;

  const envPath = String(
    process.env.INSTAGRAM_COOKIES_PATH || process.env.YTDLP_INSTAGRAM_COOKIES_PATH || ''
  ).trim();
  const candidates = [
    envPath,
    ...cookieFileCandidates('instagram_cookies.txt'),
    ...cookieFileCandidates('instagram.txt')
  ].filter(Boolean);

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const normalized = normalizeCookieFileContent(readFileSync(p, 'utf8'));
      if (!normalized.includes('instagram.com')) continue;
      writeFileSync(p, `${normalized}\n`, 'utf8');
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function logInstagramCookiesStatus() {
  const path = resolveInstagramCookiesPath();
  if (path) {
    console.log(`[instagram-cookies] ready (${path})`);
    return { ok: true, path };
  }
  console.warn(
    '[instagram-cookies] NOT configured — put cookies/instagram_cookies.txt on server or set INSTAGRAM_COOKIES_BASE64 in .env'
  );
  return { ok: false, path: null };
}

/** Cookies-first when available; anonymous only as last resort. */
export function buildInstagramAuthVariants() {
  const variants = [];
  const igPath = resolveInstagramCookiesPath();
  if (igPath) {
    variants.push({ label: 'instagram_cookies', extraArgs: ['--cookies', igPath] });
  }
  const browser = String(
    process.env.INSTAGRAM_COOKIES_BROWSER || process.env.YTDLP_COOKIES_FROM_BROWSER || ''
  ).trim();
  if (browser) {
    variants.push({ label: `browser_${browser}`, extraArgs: ['--cookies-from-browser', browser] });
  }
  const shared = resolveCookiesPath();
  if (shared && shared !== igPath) {
    variants.push({ label: 'shared_cookies', extraArgs: ['--cookies', shared] });
  }
  variants.push({ label: 'anonymous', extraArgs: [] });
  return variants;
}

export function isInstagramAuthBlock(stderr = '') {
  const text = String(stderr || '').toLowerCase();
  return (
    text.includes('login required') ||
    text.includes('you need to log in') ||
    text.includes('cookies') ||
    text.includes('empty media response') ||
    text.includes('empty json') ||
    text.includes('rate-limit') ||
    text.includes('http error 401') ||
    text.includes('http error 403') ||
    (text.includes('instagram') && text.includes('unable to extract'))
  );
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
    text.includes('members-only') ||
    isInstagramAuthBlock(text)
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

function buildYoutubeExtractorArgs(client) {
  const parts = [`youtube:player_client=${client}`];
  const poToken = String(process.env.YTDLP_YOUTUBE_PO_TOKEN || '').trim();
  const visitorData = String(process.env.YTDLP_YOUTUBE_VISITOR_DATA || '').trim();
  if (poToken) parts.push(`po_token=${poToken}`);
  if (visitorData) parts.push(`visitor_data=${visitorData}`);
  return parts.join(',');
}

function resolveYoutubePlayerClients(isShorts = false) {
  const envList = String(process.env.YTDLP_YOUTUBE_CLIENTS || '').trim();
  const defaults = isShorts
    ? ['android', 'ios', 'tv_embedded', 'mweb', 'web_creator', 'web']
    : ['android', 'tv_embedded', 'ios', 'mweb', 'web_creator', 'web'];
  const clients = (envList ? envList.split(',') : defaults)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(clients)];
}

function buildFastStrategyArgs(baseArgs, url, cookiesPath, opts = {}) {
  const strategies = [];
  const browser = String(process.env.YTDLP_COOKIES_FROM_BROWSER || process.env.YOUTUBE_COOKIES_BROWSER || '').trim();
  if (browser) {
    strategies.push({
      profile: `browser_${browser}`,
      cookiesEnabled: true,
      args: [...baseArgs, '--cookies-from-browser', browser, url]
    });
  }
  if (cookiesPath) {
    strategies.push({
      profile: 'cookies_file_android',
      cookiesEnabled: true,
      args: [...baseArgs, '--cookies', cookiesPath, '--extractor-args', buildYoutubeExtractorArgs('android'), url]
    });
  }
  for (const client of ['android', 'ios', 'tv_embedded']) {
    strategies.push({
      profile: client,
      cookiesEnabled: false,
      args: [...baseArgs, '--extractor-args', buildYoutubeExtractorArgs(client), url]
    });
  }
  strategies.push({ profile: 'web', cookiesEnabled: false, args: [...baseArgs, url] });
  return strategies;
}

function buildStrategyArgs(baseArgs, url, cookiesPath, opts = {}) {
  const isShorts = Boolean(opts.isShorts);
  const strategies = [];

  for (const client of resolveYoutubePlayerClients(isShorts)) {
    if (client === 'normal' || client === 'web') {
      strategies.push({ profile: client, cookiesEnabled: false, args: [...baseArgs, url] });
      continue;
    }
    strategies.push({
      profile: client,
      cookiesEnabled: false,
      args: [...baseArgs, '--extractor-args', buildYoutubeExtractorArgs(client), url]
    });
  }

  const browser = String(process.env.YTDLP_COOKIES_FROM_BROWSER || process.env.YOUTUBE_COOKIES_BROWSER || '').trim();
  if (browser) {
    strategies.push({
      profile: `browser_${browser}`,
      cookiesEnabled: true,
      args: [...baseArgs, '--cookies-from-browser', browser, url]
    });
    for (const client of ['android', 'web']) {
      strategies.push({
        profile: `browser_${browser}_${client}`,
        cookiesEnabled: true,
        args: [
          ...baseArgs,
          '--cookies-from-browser',
          browser,
          '--extractor-args',
          buildYoutubeExtractorArgs(client),
          url
        ]
      });
    }
  }

  if (cookiesPath) {
    strategies.push({
      profile: 'cookies_file',
      cookiesEnabled: true,
      args: [...baseArgs, '--cookies', cookiesPath, url]
    });
    strategies.push({
      profile: 'cookies_file_android',
      cookiesEnabled: true,
      args: [...baseArgs, '--cookies', cookiesPath, '--extractor-args', buildYoutubeExtractorArgs('android'), url]
    });
  }

  return strategies;
}

function normalizeYoutubeUrlIfShorts(url, isShortsHint = false) {
  const raw = String(url || '');
  const isShorts = isShortsHint || /youtube\.com\/shorts\//i.test(raw);
  if (!isShorts) {
    const id = parseYouTubeVideoId(raw);
    return {
      normalizedUrl: id ? normalizeYouTubeWatchUrl(id) || raw : raw,
      urlNormalized: Boolean(id),
      isShorts: false,
      alternateUrls: []
    };
  }
  const id = parseYouTubeVideoId(raw);
  if (!id) return { normalizedUrl: raw, urlNormalized: false, isShorts: true, alternateUrls: [] };
  const shortsUrl = `https://www.youtube.com/shorts/${id}`;
  const watchUrl = normalizeYouTubeWatchUrl(id) || raw;
  return {
    normalizedUrl: shortsUrl,
    urlNormalized: true,
    isShorts: true,
    alternateUrls: watchUrl !== shortsUrl ? [watchUrl] : []
  };
}

function urlsForExtraction(normalization) {
  const primary = normalization.normalizedUrl;
  const alternates = Array.isArray(normalization.alternateUrls) ? normalization.alternateUrls : [];
  return [...new Set([primary, ...alternates].filter(Boolean))];
}

function modeUsesFormatFallbacks(mode) {
  return mode === 'extract' || mode === 'audio_extract' || mode === 'download';
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
    const { stdout } = await runOne(ytDlpPath, ['--version'], process.cwd(), null);
    cachedYtdlpVersion = String(stdout || '').trim() || 'unknown';
  } catch {
    cachedYtdlpVersion = 'unknown';
  }
  return cachedYtdlpVersion;
}

async function probeFormatsCount(ytDlpPath, url, cwd) {
  try {
    const { stdout } = await runOne(ytDlpPath, ['--list-formats', '--no-playlist', url], cwd, null);
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

async function runOne(ytDlpPath, args, cwd, traceId = null, timeoutMs = YTDLP_TIMEOUT_MS) {
  return spawnWithTimeout(ytDlpPath, args, {
    cwd,
    timeoutMs,
    traceId,
    label: 'yt-dlp'
  });
}

/** Parse JSON metadata from yt-dlp --dump-json stdout (may include progress lines). */
export function parseYtdlpDumpJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* try earlier line */
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runYtDlpAttemptMatrix(ctx) {
  const {
    ytDlpPath,
    cwd,
    traceId,
    mode,
    targetUrls,
    strategies,
    formatFallbacks,
    maxRetries,
    attemptTimeoutMs,
    deadline,
    phase,
    urlNormalized
  } = ctx;

  let lastErr = null;
  for (const targetUrl of targetUrls) {
    for (const fmt of formatFallbacks) {
      for (const strategy of strategies) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          if (deadline && Date.now() >= deadline) {
            throw (
              lastErr ||
              Object.assign(new Error('YouTube extraction timed out'), {
                code: 'YTDLP_TIMEOUT',
                temporary: true
              })
            );
          }
          const args = fmt ? [...strategy.args, '-f', fmt] : [...strategy.args];
          logYtdlp('[ytdlp-debug]', {
            traceId: traceId || null,
            phase,
            extractor: 'yt-dlp',
            clientProfile: strategy.profile,
            retries: attempt,
            cookiesEnabled: strategy.cookiesEnabled,
            mode,
            targetUrl,
            selectedFormat: fmt || '(n/a)'
          });
          try {
            const result = await runOne(ytDlpPath, args, cwd, traceId, attemptTimeoutMs);
            logYtdlp('[ytdlp-stream-debug]', {
              traceId: traceId || null,
              phase,
              selectedFormat: fmt || '(n/a)',
              extractor: 'yt-dlp',
              playerClient: strategy.profile,
              cookiesEnabled: strategy.cookiesEnabled,
              targetUrl,
              urlNormalized
            });
            return { ...result, strategy, selectedFormat: fmt || null, normalizedUrl: targetUrl };
          } catch (err) {
            const mapped = classifyYtDlpError(err?.stderr || err?.message || '');
            lastErr = Object.assign(new Error(mapped.message), {
              code: mapped.code,
              temporary: mapped.temporary,
              stdout: err?.stdout || '',
              stderr: err?.stderr || '',
              selectedFormat: fmt || null,
              targetUrl
            });
            if (!mapped.temporary || attempt >= maxRetries) break;
            const backoffMs = Math.min(3000, 280 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 180);
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }
    }
  }
  if (lastErr) {
    return { __failed: true, error: lastErr };
  }
  return null;
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
    isShorts = false,
    maxTotalMs = null,
    proxyProvider = null // future proxy rotation hook
  } = opts;
  void proxyProvider;
  const normalization = normalizeYoutubeUrlIfShorts(url, isShorts === true);
  const cookiesPath = resolveCookiesPath();
  const baseNoFormat = stripFormatArgs(baseArgs);
  const resolvedFormatFallbacks =
    Array.isArray(formatFallbacks) && formatFallbacks.length
      ? formatFallbacks
      : ['bestvideo+bestaudio', 'best', 'mp4', 'worst'];
  const effectiveFormatFallbacks = modeUsesFormatFallbacks(mode) ? resolvedFormatFallbacks : [null];
  const extractionUrls = urlsForExtraction(normalization);
  const defaultBudget =
    mode === 'metadata' || mode === 'subtitle_fetch'
      ? 22000
      : mode === 'audio_extract'
        ? 52000
        : YTDLP_TIMEOUT_MS;
  const deadline = Date.now() + Number(maxTotalMs ?? defaultBudget);

  await applyYtdlpBurstDelay(requestKey);
  const version = await resolveYtdlpVersion(ytDlpPath);
  logYtdlp('[ytdlp-version-debug]', { version, path: ytDlpPath, cookiesPath: cookiesPath || null });

  const matrixCtxBase = {
    ytDlpPath,
    cwd,
    traceId,
    mode,
    deadline,
    urlNormalized: normalization.urlNormalized
  };

  const fastResult = await runYtDlpAttemptMatrix({
    ...matrixCtxBase,
    phase: 'fast',
    targetUrls: [extractionUrls[0]],
    strategies: buildFastStrategyArgs(baseNoFormat, extractionUrls[0], cookiesPath, {
      isShorts: normalization.isShorts
    }),
    formatFallbacks: effectiveFormatFallbacks,
    maxRetries: 1,
    attemptTimeoutMs: Math.min(45000, Number(process.env.YTDLP_FAST_ATTEMPT_MS || 38000))
  });
  if (fastResult && !fastResult.__failed) return fastResult;
  let lastErr = fastResult?.__failed ? fastResult.error : null;

  if (Date.now() >= deadline) {
    throw Object.assign(new Error('YouTube extraction timed out'), { code: 'YTDLP_TIMEOUT', temporary: true });
  }

  for (const targetUrl of extractionUrls) {
    const strategies = buildStrategyArgs(baseNoFormat, targetUrl, cookiesPath, {
      isShorts: normalization.isShorts
    });
    const result = await runYtDlpAttemptMatrix({
      ...matrixCtxBase,
      phase: 'full',
      targetUrls: [targetUrl],
      strategies,
      formatFallbacks: effectiveFormatFallbacks,
      maxRetries: YTDLP_MAX_RETRIES,
      attemptTimeoutMs: YTDLP_TIMEOUT_MS
    });
    if (result && !result.__failed) return result;
    if (result?.__failed) lastErr = result.error;
    if (Date.now() >= deadline) {
      throw Object.assign(new Error('YouTube extraction timed out'), { code: 'YTDLP_TIMEOUT', temporary: true });
    }
  }

  throw (
    lastErr ||
    Object.assign(new Error('Could not extract video stream'), { code: 'YTDLP_FAILED', temporary: true })
  );
}
