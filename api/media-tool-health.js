/**
 * Async health probes for media CLI tools (ffmpeg, yt-dlp).
 * Production-safe: short timeout, tolerates stderr / non-zero exit when version is printed.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 3000;
const MAX_BUFFER = 512 * 1024;

/**
 * @param {string} cmd
 * @param {string[]} args
 */
async function execProbe(cmd, args) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: PROBE_TIMEOUT_MS,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: MAX_BUFFER
    });
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (e) {
    const stdout = String(e?.stdout || '');
    const stderr = String(e?.stderr || '');
    return {
      ok: false,
      stdout,
      stderr,
      error: e?.message || String(e),
      signal: e?.signal || null,
      code: e?.code ?? null
    };
  }
}

/**
 * @param {string} name
 */
async function whichBinary(name) {
  const r = await execProbe('which', [name]);
  if (!r.ok) return null;
  const line = `${r.stdout}\n${r.stderr}`.trim().split('\n').find(Boolean);
  return line || null;
}

/**
 * @param {string} text
 */
export function parseFfmpegVersion(text) {
  const m = String(text || '').match(/ffmpeg version\s+([^\s,]+)/i);
  return m ? m[1] : null;
}

/**
 * @param {string} text
 */
export function parseYtDlpVersion(text) {
  const line = String(text || '')
    .trim()
    .split('\n')
    .find(Boolean);
  if (!line) return null;
  const m = line.match(/([\d]+\.[\d]+(?:\.[\d]+)?)/);
  return m ? m[1] : line.slice(0, 80);
}

/**
 * @param {{ stdout?: string, stderr?: string }} r
 */
function combinedOutput(r) {
  return `${r.stdout || ''}\n${r.stderr || ''}`.trim();
}

/**
 * ffmpeg: pass if `which ffmpeg` or `ffmpeg -version` yields a version line.
 * @returns {Promise<{ installed: boolean, version: string|null, status: 'operational'|'degraded'|'missing', path: string|null, detail?: string }>}
 */
export async function checkFfmpegHealth() {
  const path = await whichBinary('ffmpeg');
  const attempts = [];

  if (path) {
    attempts.push(() => execProbe(path, ['-version']));
  }
  attempts.push(() => execProbe('ffmpeg', ['-version']));

  let versionText = '';
  for (const run of attempts) {
    const r = await run();
    const out = combinedOutput(r);
    if (parseFfmpegVersion(out)) {
      versionText = out;
      break;
    }
    if (/ffmpeg version/i.test(out)) {
      versionText = out;
      break;
    }
  }

  const version = parseFfmpegVersion(versionText);

  if (!path && !version && !versionText) {
    return { installed: false, version: null, status: 'missing', path: null };
  }

  if (version) {
    return {
      installed: true,
      version,
      status: 'operational',
      path: path || null
    };
  }

  if (path) {
    return {
      installed: true,
      version: null,
      status: 'degraded',
      path,
      detail: 'ffmpeg found on PATH but version check did not complete'
    };
  }

  return { installed: false, version: null, status: 'missing', path: null };
}

/**
 * yt-dlp: keep --version probe; async with same timeout semantics.
 * @returns {Promise<{ installed: boolean, version: string|null, status: 'operational'|'degraded'|'missing', path: string|null }>}
 */
export async function checkYtDlpHealth() {
  const path = await whichBinary('yt-dlp');
  const attempts = [];

  if (path) {
    attempts.push(() => execProbe(path, ['--version']));
  }
  attempts.push(() => execProbe('yt-dlp', ['--version']));

  let versionText = '';
  for (const run of attempts) {
    const r = await run();
    const out = combinedOutput(r);
    if (out) {
      versionText = out;
      if (parseYtDlpVersion(out) || r.ok) break;
    }
  }

  const version = parseYtDlpVersion(versionText);
  const hasOutput = Boolean(versionText.trim());

  if (!path && !hasOutput) {
    return { installed: false, version: null, status: 'missing', path: null };
  }

  if (version || (hasOutput && versionText.toLowerCase().includes('yt-dlp'))) {
    return {
      installed: true,
      version: version || null,
      status: 'operational',
      path: path || null
    };
  }

  if (path || hasOutput) {
    return {
      installed: true,
      version: null,
      status: 'degraded',
      path: path || null,
      detail: 'yt-dlp found but version check was inconclusive'
    };
  }

  return { installed: false, version: null, status: 'missing', path: null };
}

/**
 * @param {{ status: string, version?: string|null, detail?: string }} t
 * @param {{ operational: string, degraded: string, missing: string }} messages
 */
export function mediaToolDetail(t, messages) {
  if (t.status === 'operational') {
    const ver = t.version ? ` ${t.version}` : '';
    return messages.operational.replace('{version}', ver).trim();
  }
  if (t.status === 'degraded') return t.detail || messages.degraded;
  return messages.missing;
}

/**
 * @param {{ status: string }} t
 */
export function mediaToolComponentStatus(t) {
  if (t.status === 'operational') return 'healthy';
  if (t.status === 'missing') return 'degraded';
  return 'degraded';
}
