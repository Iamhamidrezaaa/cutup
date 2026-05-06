/**
 * Live activity feed for Creator Wall (Phase 1 curated; Phase 2 → DB aggregates).
 */

const COUNTRY_NAMES = {
  US: 'USA',
  GB: 'UK',
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
  AU: 'Australia',
  MX: 'Mexico'
};

const EVENTS = [
  { type: 'subtitles', platform: 'TikTok', country: 'DE', style: null },
  { type: 'export', platform: 'Podcast', country: 'CA', style: null },
  { type: 'render', platform: null, country: 'US', style: 'Hormozi' },
  { type: 'export', platform: 'Reels', country: 'UK', style: null },
  { type: 'subtitles', platform: 'YouTube', country: 'US', style: null },
  { type: 'render', platform: null, country: 'FR', style: 'MrBeast' },
  { type: 'highlights', platform: 'TikTok', country: 'AU', style: null },
  { type: 'export', platform: 'Shorts', country: 'MX', style: null },
  { type: 'subtitles', platform: 'Instagram', country: 'US', style: null },
  { type: 'render', platform: null, country: 'GB', style: 'TikTok Neon' }
];

function formatMessage(ev) {
  const country = COUNTRY_NAMES[ev.country] || ev.country;
  if (ev.type === 'subtitles') {
    return `New ${ev.platform} subtitles generated · ${country}`;
  }
  if (ev.type === 'render') {
    return `${ev.style} style render completed · ${country}`;
  }
  if (ev.type === 'highlights') {
    return `AI highlights extracted · ${country}`;
  }
  if (ev.platform === 'Podcast') {
    return `Podcast transcript exported · ${country}`;
  }
  return `Viral captions exported · ${country}`;
}

/** Phase 1: rotate curated events. Phase 2: merge usage_history aggregates. */
export function getCreatorWallActivityFeed({ limit = 12 } = {}) {
  const n = Math.min(limit, EVENTS.length);
  const offset = Math.floor(Date.now() / 8000) % EVENTS.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const ev = EVENTS[(offset + i) % EVENTS.length];
    out.push({
      id: `act_${offset}_${i}`,
      message: formatMessage(ev),
      at: new Date(Date.now() - i * 4200).toISOString()
    });
  }
  return out;
}
