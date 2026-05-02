/** Programmatic SEO guide slugs → /tools/{slug}-guide.html */
export const SEO_GUIDE_TYPES = [
  'youtube-to-text',
  'instagram-subtitles',
  'tiktok-caption-generator',
];

export function guidePathForType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (!SEO_GUIDE_TYPES.includes(t)) return null;
  return `/tools/${t}-guide.html`;
}
