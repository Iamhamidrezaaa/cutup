/**
 * Physical blog HTML files: {repo}/blog/{slug}.html
 */
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BLOG_HTML_DIR = join(__dirname, '..', 'blog');

export function canonicalBlogUrl(slug) {
  return `https://cutup.shop/blog/${encodeURIComponent(String(slug || '').trim())}`;
}

export function blogHtmlRelativePath(slug) {
  const safe = String(slug || '').trim();
  if (!safe) return '';
  return `/blog/${safe}.html`;
}

export function blogHtmlFilePath(slug) {
  const safe = String(slug || '').trim();
  if (!safe || safe.includes('..') || safe.includes('/') || safe.includes('\\')) {
    throw new Error('invalid_blog_slug');
  }
  return join(BLOG_HTML_DIR, `${safe}.html`);
}

export function writeBlogHtmlFile(slug, html) {
  mkdirSync(BLOG_HTML_DIR, { recursive: true });
  const abs = blogHtmlFilePath(slug);
  writeFileSync(abs, html, 'utf8');
  return blogHtmlRelativePath(slug);
}

export function deleteBlogHtmlFile(slug) {
  const safe = String(slug || '').trim();
  if (!safe) return false;
  try {
    const abs = blogHtmlFilePath(safe);
    if (existsSync(abs)) {
      unlinkSync(abs);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function blogHtmlFileExists(slug) {
  try {
    return existsSync(blogHtmlFilePath(slug));
  } catch {
    return false;
  }
}

/** List card shape from blog/*.html when DB is empty (recovery). */
export function listPublicPostsFromHtmlFiles() {
  if (!existsSync(BLOG_HTML_DIR)) return [];
  return readdirSync(BLOG_HTML_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((file) => {
      const slug = file.slice(0, -5);
      let title = slug.replace(/-/g, ' ');
      let excerpt = '';
      try {
        const html = readFileSync(join(BLOG_HTML_DIR, file), 'utf8');
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].replace(/\s*[—–-]\s*Cutup\s*$/i, '').trim();
        }
        const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        if (descMatch) excerpt = descMatch[1];
      } catch {
        /* ignore */
      }
      return {
        id: `file:${slug}`,
        slug,
        title,
        titleShort: title,
        titleSuffix: '',
        excerpt,
        category: '',
        tags: [],
        coverImageUrl: '',
        publishedAt: null,
        updatedAt: null,
        readingTimeMinutes: null,
        source: 'file',
        url: `/blog/${slug}`,
        htmlPath: `/blog/${slug}.html`
      };
    });
}
