#!/usr/bin/env node
/**
 * One-time: export website/blog-pages/* → blog/{slug}.html + upsert blog_posts rows.
 *
 * Usage:
 *   DATABASE_URL=... node api/db/migrate-blog-html.mjs
 *   node api/db/migrate-blog-html.mjs --dry-run
 *   node api/db/migrate-blog-html.mjs --files-only   # skip DB (no DATABASE_URL)
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool, isBillingDbConfigured, closePool } from './pool.js';
import { listStaticBlogSlugs, getStaticBlogArticle } from '../blog-static-registry.js';
import { renderBlogPostPage } from '../blog-ssr.js';
import { writeBlogHtmlFile, blogHtmlRelativePath } from '../blog-files.js';
import { syncBlogPostHtml } from '../blog-publish.js';
import { writeBlogPostsIndex } from '../blog-index-json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const filesOnly = process.argv.includes('--files-only');

async function applyHtmlPathMigration(pool) {
  const sql = readFileSync(join(__dirname, 'schema-blog-html-path.sql'), 'utf8');
  await pool.query(sql);
  console.log('Applied schema-blog-html-path.sql');
}

async function upsertPostFromArticle(pool, article, htmlPath) {
  const slug = article.slug;
  const tags = Array.isArray(article.tags) ? article.tags : [];
  const status = article.status === 'published' ? 'published' : 'draft';
  const publishedAt = status === 'published' ? article.publishedAt || new Date() : null;

  await pool.query(
    `INSERT INTO blog_posts (
      slug, title, cover_image_url, excerpt, content, content_html, status, category, tags,
      meta_title, meta_description, og_title, og_description, published_at, html_path, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      cover_image_url = EXCLUDED.cover_image_url,
      excerpt = EXCLUDED.excerpt,
      content = EXCLUDED.content,
      content_html = EXCLUDED.content_html,
      status = EXCLUDED.status,
      category = EXCLUDED.category,
      tags = EXCLUDED.tags,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      published_at = CASE WHEN EXCLUDED.status = 'published'
        THEN COALESCE(blog_posts.published_at, EXCLUDED.published_at) ELSE NULL END,
      html_path = EXCLUDED.html_path,
      updated_at = NOW()`,
    [
      slug,
      article.title + (article.titleSuffix ? ` ${article.titleSuffix}` : ''),
      article.coverImageUrl || '',
      article.excerpt || article.deck || '',
      '',
      article.bodyHtml || '',
      status,
      article.category || '',
      tags,
      article.metaTitle || article.title,
      article.metaDescription || article.excerpt || '',
      article.ogTitle || article.metaTitle || article.title,
      article.ogDescription || article.metaDescription || '',
      publishedAt,
      htmlPath
    ]
  );
}

async function main() {
  const slugs = listStaticBlogSlugs();
  if (!slugs.length) {
    console.log('No website/blog-pages/ articles found.');
    return;
  }

  const pool = isBillingDbConfigured() && !filesOnly ? getPool() : null;
  if (pool) await applyHtmlPathMigration(pool);

  let ok = 0;
  for (const slug of slugs) {
    const article = getStaticBlogArticle(slug);
    if (!article) {
      console.warn('skip (missing files):', slug);
      continue;
    }
    const html = renderBlogPostPage(article);
    if (!html) {
      console.warn('skip (render failed):', slug);
      continue;
    }
    if (dryRun) {
      console.log('[dry-run] would write', slug, `${html.length} bytes`);
      ok++;
      continue;
    }
    const htmlPath = writeBlogHtmlFile(slug, html);
    console.log('wrote', htmlPath);

    if (pool && article.status === 'published') {
      try {
        await upsertPostFromArticle(pool, article, blogHtmlRelativePath(slug));
        console.log('  db upsert', slug);
      } catch (err) {
        console.error('  db upsert failed', slug, err.message);
      }
    }
    ok++;
  }

  if (pool && !dryRun && !filesOnly) {
    const { rows } = await pool.query(
      `SELECT id, slug FROM blog_posts WHERE status = 'published' AND (html_path IS NULL OR html_path = '')`
    );
    for (const row of rows) {
      try {
        const r = await syncBlogPostHtml(String(row.id));
        console.log('regenerated existing', row.slug, r.action);
      } catch (e) {
        console.warn('regenerate failed', row.slug, e.message);
      }
    }
  }

  if (!dryRun) {
    const index = writeBlogPostsIndex();
    console.log('wrote website/blog-posts.json', `(${index.posts.length} posts)`);
  }

  console.log(`Done: ${ok}/${slugs.length} articles.`);
  if (pool) await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
