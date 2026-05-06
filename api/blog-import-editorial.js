/**
 * Import website/blog-pages/* into blog_posts (for admin Content Studio).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { listStaticBlogSlugs, getStaticBlogArticle } from './blog-static-registry.js';
import { blogHtmlRelativePath } from './blog-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function ensureHtmlPathColumn(pool) {
  const sql = readFileSync(join(__dirname, 'db', 'schema-blog-html-path.sql'), 'utf8');
  await pool.query(sql);
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

/** @returns {Promise<{ ok: boolean, imported: number, errors: string[] }>} */
export async function importEditorialBlogPostsToDb() {
  if (!isBillingDbConfigured()) {
    return { ok: false, imported: 0, errors: ['DATABASE_URL not configured'] };
  }
  const slugs = listStaticBlogSlugs();
  if (!slugs.length) {
    return { ok: false, imported: 0, errors: ['No website/blog-pages/ articles found'] };
  }

  const pool = getPool();
  await ensureHtmlPathColumn(pool);

  const errors = [];
  let imported = 0;
  for (const slug of slugs) {
    const article = getStaticBlogArticle(slug);
    if (!article) {
      errors.push(`skip ${slug}: missing meta/body`);
      continue;
    }
    try {
      await upsertPostFromArticle(pool, article, blogHtmlRelativePath(slug));
      imported++;
    } catch (err) {
      errors.push(`${slug}: ${err?.message || err}`);
    }
  }
  return { ok: errors.length === 0, imported, errors };
}
