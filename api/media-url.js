/**
 * Normalize and validate creator platform URLs (YouTube Shorts, Instagram, TikTok).
 */

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return new URL(s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`);
  } catch {
    return null;
  }
}

/**
 * @param {string} urlOrId
 * @returns {string|null} 11-char video id
 */
export function parseYouTubeVideoId(urlOrId) {
  const raw = String(urlOrId || '').trim();
  if (!raw) return null;
  if (YT_ID_RE.test(raw)) return raw;

  const u = safeUrl(raw);
  if (u) {
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      return YT_ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const v = u.searchParams.get('v');
        return v && YT_ID_RE.test(v) ? v : null;
      }
      const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/i);
      if (m && YT_ID_RE.test(m[2])) return m[2];
    }
  }

  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{11})/i,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/i,
    /[?&]v=([a-zA-Z0-9_-]{11})/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && YT_ID_RE.test(m[1])) return m[1];
  }
  return null;
}

/** @param {string} url */
export function normalizeYouTubeWatchUrl(url) {
  const id = parseYouTubeVideoId(url);
  if (!id) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

/** Strip common tracking params; keep v= for YouTube. */
export function stripTrackingQueryParams(url) {
  const u = safeUrl(url);
  if (!u) return String(url || '').trim();
  const drop = ['si', 'feature', 'fbclid', 'igsh', 'igshid', 'utm_source', 'utm_medium', 'utm_campaign'];
  for (const key of [...u.searchParams.keys()]) {
    if (drop.includes(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.hash = '';
  return u.toString();
}

/**
 * @param {string} pathname
 */
export function isInstagramMediaPath(pathname) {
  const p = String(pathname || '/');
  if (/^\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?$/i.test(p)) return true;
  if (/^\/stories\/[^/]+\/\d+\/?$/i.test(p)) return true;
  return false;
}

/** @param {string} url */
export function normalizeInstagramUrl(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('instagram.com')) return null;
  let path = u.pathname.replace(/\/+$/, '') || '/';
  path = path.replace(/^\/reels\//i, '/reel/');
  if (!isInstagramMediaPath(path)) return null;
  return `https://www.instagram.com${path}${path.endsWith('/') ? '' : '/'}`;
}

/** @param {string} url */
export function detectPlatformFromUrl(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  return null;
}

/** @param {string} url @param {string} platform */
export function validateMediaUrl(url, platform) {
  const cleaned = stripTrackingQueryParams(url);
  const p = platform || detectPlatformFromUrl(cleaned);
  if (!p) return { ok: false, code: 'INVALID_URL', reason: 'This link format is not supported yet.' };

  if (p === 'youtube') {
    const id = parseYouTubeVideoId(cleaned);
    if (!id) {
      const looksShorts = /\/shorts\//i.test(cleaned);
      return {
        ok: false,
        code: looksShorts ? 'SHORTS_PARSE_ERROR' : 'UNSUPPORTED_YOUTUBE_URL',
        reason: looksShorts
          ? "We couldn't recognize this Shorts link."
          : 'Please paste a direct YouTube video link.'
      };
    }
    return { ok: true, platform: 'youtube', normalizedUrl: normalizeYouTubeWatchUrl(cleaned), videoId: id };
  }

  if (p === 'instagram') {
    const norm = normalizeInstagramUrl(cleaned);
    if (!norm) {
      const isStory = /\/stories\//i.test(cleaned);
      return {
        ok: false,
        code: isStory ? 'UNSUPPORTED_INSTAGRAM_URL' : 'UNSUPPORTED_INSTAGRAM_URL',
        reason: isStory
          ? 'Instagram Stories are not publicly downloadable. Please use a Reel or Post URL.'
          : 'Please paste a direct Instagram Reel, Post, or Video link.'
      };
    }
    return { ok: true, platform: 'instagram', normalizedUrl: norm };
  }

  if (p === 'tiktok') {
    const u = safeUrl(cleaned);
    const path = u?.pathname || '';
    if (/^\/@[^/]+\/video\/\d+/i.test(path) || /^\/t\/[A-Za-z0-9]+/i.test(path)) {
      return { ok: true, platform: 'tiktok', normalizedUrl: u.toString() };
    }
    return { ok: false, code: 'UNSUPPORTED_TIKTOK_URL', reason: 'Please paste a direct TikTok video link.' };
  }

  return { ok: false, code: 'UNSUPPORTED_PLATFORM', reason: 'This link format is not supported yet.' };
}
