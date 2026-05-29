/**
 * fontconfig probe for RTL subtitle burn-in (Persian/Arabic).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveRtlFontFallbackChain } from './rtl-text.js';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 4000;

async function fcList(lang) {
  try {
    const { stdout } = await execFileAsync('fc-list', [`:lang=${lang}`, 'family', 'file'], {
      timeout: PROBE_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 256 * 1024
    });
    return String(stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function chainMatch(lines, chain) {
  const blob = (lines || []).join('\n').toLowerCase();
  for (const name of chain) {
    if (name === 'sans-serif') continue;
    if (blob.includes(name.toLowerCase())) return name;
  }
  return null;
}

/**
 * @returns {Promise<{ ok: boolean, status: 'operational'|'degraded'|'missing'|'unknown', matchedFont: string|null, arLines: number, faLines: number, fallbackChain: string[], detail?: string }>}
 */
export async function checkRtlSubtitleFontsHealth() {
  const fallbackChain = resolveRtlFontFallbackChain();
  const arLines = await fcList('ar');
  const faLines = await fcList('fa');

  if (arLines == null && faLines == null) {
    return {
      ok: false,
      status: 'unknown',
      matchedFont: null,
      arLines: 0,
      faLines: 0,
      fallbackChain,
      detail: 'fc-list unavailable — run api/video-render/setup-fonts.sh on the server'
    };
  }

  const ar = arLines || [];
  const fa = faLines || [];
  const matchedFont = chainMatch(ar, fallbackChain) || chainMatch(fa, fallbackChain);

  if (matchedFont) {
    return {
      ok: true,
      status: 'operational',
      matchedFont,
      arLines: ar.length,
      faLines: fa.length,
      fallbackChain
    };
  }

  if (ar.length > 0 || fa.length > 0) {
    return {
      ok: true,
      status: 'degraded',
      matchedFont: null,
      arLines: ar.length,
      faLines: fa.length,
      fallbackChain,
      detail: 'Arabic/Persian fonts present but preferred Noto family not detected by name'
    };
  }

  return {
    ok: false,
    status: 'missing',
    matchedFont: null,
    arLines: 0,
    faLines: 0,
    fallbackChain,
    detail: 'No :lang=ar or :lang=fa fonts — RTL burn-in will break. Run setup-fonts.sh'
  };
}
