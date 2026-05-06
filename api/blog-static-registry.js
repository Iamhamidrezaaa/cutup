/**
 * Filesystem-backed editorial articles: website/blog-pages/<slug>/
 *   meta.json  — SEO + list card metadata
 *   body.html  — article inner HTML (injected into template)
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BLOG_PAGES_DIR = join(__dirname, '..', 'website', 'blog-pages');

/** Web path for editorial blog covers (files live under website/cms-media/images/blog/). */
export const BLOG_COVER_MEDIA_PREFIX = '/cms-media/images/blog';

/** Map legacy /images/blog/… paths to cms-media (production uploads). */
export function resolveBlogCoverImageUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('/images/blog/')) {
    return `${BLOG_COVER_MEDIA_PREFIX}${u.slice('/images/blog'.length)}`;
  }
  return u;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @returns {import('./blog-types.js').BlogArticleMeta[]}
 */
export function listStaticBlogSlugs() {
  if (!existsSync(BLOG_PAGES_DIR)) return [];
  return readdirSync(BLOG_PAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
}

/**
 * @param {string} slug
 */
export function getStaticBlogArticle(slug) {
  const safe = String(slug || '').trim();
  if (!safe || safe.includes('..') || safe.includes('/') || safe.includes('\\')) return null;

  const dir = join(BLOG_PAGES_DIR, safe);
  const metaPath = join(dir, 'meta.json');
  const bodyPath = join(dir, 'body.html');
  if (!existsSync(metaPath) || !existsSync(bodyPath)) return null;

  const meta = readJson(metaPath);
  const bodyHtml = readFileSync(bodyPath, 'utf8');
  const stat = statSync(metaPath);

  return {
    ...meta,
    slug: meta.slug || safe,
    coverImageUrl: resolveBlogCoverImageUrl(meta.coverImageUrl),
    bodyHtml,
    source: 'static',
    status: meta.status || 'published',
    updatedAt: meta.updatedAt || stat.mtime.toISOString().slice(0, 10)
  };
}

/**
 * List card shape for blog index API.
 */
export function listStaticBlogArticles() {
  return listStaticBlogSlugs()
    .map((slug) => {
      const article = getStaticBlogArticle(slug);
      if (!article || article.status !== 'published') return null;
      return toListItem(article);
    })
    .filter(Boolean);
}

export function toListItem(article) {
  return {
    id: `static:${article.slug}`,
    slug: article.slug,
    title: article.title + (article.titleSuffix ? ` ${article.titleSuffix}` : ''),
    titleShort: article.title,
    titleSuffix: article.titleSuffix || '',
    excerpt: article.excerpt || '',
    category: article.category || '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    coverImageUrl: article.coverImageUrl || '',
    publishedAt: article.publishedAt || article.updatedAt || null,
    updatedAt: article.updatedAt || article.publishedAt || null,
    readingTimeMinutes: article.readingTimeMinutes || null,
    source: article.source || 'static',
    url: `/blog/${article.slug}`
  };
}
