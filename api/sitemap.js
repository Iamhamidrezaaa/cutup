import { SEO_GUIDE_TYPES } from './seo-guide-config.js';
import { listAllBlogArticles } from './blog-resolve.js';

const BASE_URL = 'https://cutup.shop';
const STATIC_PATHS = [
  '/',
  '/blog.html',
  '/faq.html',
  '/about.html',
  '/contact.html',
  '/privacy.html',
  '/terms.html',
  '/video-to-text.html',
  '/translate-video.html',
  ...SEO_GUIDE_TYPES.map((t) => `/tools/${t}-guide.html`),
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

function buildSitemapXml(blogArticles = []) {
  const staticLastmod = new Date().toISOString().slice(0, 10);
  const urls = [
    ...STATIC_PATHS.map((path) => ({
      loc: `${BASE_URL}${path}`,
      lastmod: staticLastmod,
    })),
    ...blogArticles.map((article) => ({
      loc: `${BASE_URL}/blog/${encodeURIComponent(String(article.slug || ''))}`,
      lastmod: toLastmod(article.publishedAt || article.updatedAt) || staticLastmod,
    })),
  ];
  const body = urls
    .map((item) => {
      const lm = escapeXml(item.lastmod || staticLastmod);
      return `  <url>\n    <loc>${escapeXml(item.loc)}</loc>\n    <lastmod>${lm}</lastmod>\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const blogArticles = await listAllBlogArticles();
    const xml = buildSitemapXml(blogArticles);
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
