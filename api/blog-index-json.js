/**
 * Static blog index for /blog.html — written by migrate-blog-html.mjs.
 * Merged into GET /api/blog/posts when DB or blog-pages is out of sync on deploy.
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listStaticBlogArticles } from './blog-static-registry.js';
import { blogHtmlFileExists } from './blog-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BLOG_POSTS_INDEX_PATH = join(__dirname, '..', 'website', 'blog-posts.json');

export function buildBlogPostsIndex() {
  const posts = listStaticBlogArticles()
    .filter((p) => blogHtmlFileExists(p.slug))
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      titleShort: p.titleShort,
      titleSuffix: p.titleSuffix || '',
      excerpt: p.excerpt || '',
      category: p.category || '',
      tags: p.tags || [],
      coverImageUrl: p.coverImageUrl || '',
      publishedAt: p.publishedAt || p.updatedAt || null,
      updatedAt: p.updatedAt || p.publishedAt || null,
      readingTimeMinutes: p.readingTimeMinutes || null,
      source: 'static',
      url: p.url || `/blog/${p.slug}`,
      htmlPath: `/blog/${p.slug}.html`
    }));
  posts.sort((a, b) => {
    const da = new Date(a.publishedAt || a.updatedAt || 0).getTime();
    const db = new Date(b.publishedAt || b.updatedAt || 0).getTime();
    return db - da;
  });
  return { generatedAt: new Date().toISOString(), posts };
}

export function writeBlogPostsIndex() {
  const payload = buildBlogPostsIndex();
  writeFileSync(BLOG_POSTS_INDEX_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function readBlogPostsIndex() {
  if (!existsSync(BLOG_POSTS_INDEX_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(BLOG_POSTS_INDEX_PATH, 'utf8'));
    return Array.isArray(data.posts) ? data.posts : [];
  } catch {
    return [];
  }
}
