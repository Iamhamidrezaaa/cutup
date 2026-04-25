import { getPool, isBillingDbConfigured } from './db/pool.js';

const BASE_URL = 'https://cutup.shop';
const STATIC_URLS = [
  `${BASE_URL}/`,
  `${BASE_URL}/blog.html`,
  `${BASE_URL}/subtitle-generator.html`,
  `${BASE_URL}/video-to-text.html`,
  `${BASE_URL}/translate-video.html`
];

function toLastmod(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemapXml(postRows = []) {
  const urls = [
    ...STATIC_URLS.map((loc) => ({ loc, lastmod: '' })),
    ...postRows.map((row) => ({
      loc: `${BASE_URL}/blog.html?slug=${encodeURIComponent(String(row.slug || ''))}`,
      lastmod: toLastmod(row.published_at || row.updated_at)
    }))
  ];
  const body = urls.map((item) => {
    const lastmodTag = item.lastmod ? `\n    <lastmod>${escapeXml(item.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(item.loc)}</loc>${lastmodTag}\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function listPublishedPostsForSitemap() {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  const result = await pool.query(
    `SELECT slug, published_at, updated_at
     FROM blog_posts
     WHERE status = 'published'
       AND COALESCE(slug, '') <> ''
     ORDER BY COALESCE(published_at, updated_at) DESC NULLS LAST`
  );
  return result.rows;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const posts = await listPublishedPostsForSitemap();
    const xml = buildSitemapXml(posts);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    return res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] generation failed', error);
    const xml = buildSitemapXml([]);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(xml);
  }
}
