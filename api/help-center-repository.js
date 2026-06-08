import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureOperationsV3Schema } from './operations-bootstrap.js';
import { HELP_ARTICLES, HELP_CATEGORIES, HELP_CONTENT_VERSION } from './help-center-content.js';
import { fuzzySearchArticles } from './help-fuzzy-search.js';

let helpSeededVersion = 0;

function parseArticleBody(raw) {
  if (!raw) {
    return {
      content: '',
      steps: [],
      tips: [],
      troubleshooting: [],
      faq: [],
      related_slugs: [],
      reading_minutes: 3,
      hero_image: null,
    };
  }
  if (typeof raw === 'object') return raw;
  const str = String(raw).trim();
  if (str.startsWith('{')) {
    try {
      return JSON.parse(str);
    } catch {
      return { content: str, steps: [], tips: [], troubleshooting: [], faq: [], related_slugs: [], reading_minutes: 3 };
    }
  }
  return { content: str, steps: [], tips: [], troubleshooting: [], faq: [], related_slugs: [], reading_minutes: 3 };
}

function mapArticle(row, extra = {}) {
  const body = parseArticleBody(row.body);
  return {
    id: Number(row.id),
    slug: row.slug,
    category_slug: row.category_slug,
    category_title: row.category_title || extra.category_title || null,
    category_icon: row.category_icon || null,
    title: row.title,
    summary: row.summary,
    body,
    tags: row.tags || [],
    is_popular: Boolean(row.is_popular),
    view_count: Number(row.view_count || 0),
    reading_minutes: body.reading_minutes || 3,
    hero_image: body.hero_image || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function ensureHelpCenterSeed() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureOperationsV3Schema();
  if (helpSeededVersion >= HELP_CONTENT_VERSION) return { ok: true, cached: true };

  const pool = getPool();

  await pool.query(`DELETE FROM help_articles WHERE category_slug = 'api'`);
  await pool.query(`DELETE FROM help_categories WHERE slug = 'api'`);

  for (const cat of HELP_CATEGORIES) {
    await pool.query(
      `INSERT INTO help_categories (slug, title, description, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order`,
      [cat.slug, cat.title, cat.description, cat.icon, cat.sort_order],
    );
  }

  for (const art of HELP_ARTICLES) {
    await pool.query(
      `INSERT INTO help_articles (slug, category_slug, title, summary, body, tags, is_popular)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7)
       ON CONFLICT (slug) DO UPDATE SET
         category_slug = EXCLUDED.category_slug,
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         body = EXCLUDED.body,
         tags = EXCLUDED.tags,
         is_popular = EXCLUDED.is_popular,
         updated_at = NOW()`,
      [art.slug, art.category_slug, art.title, art.summary, art.body, art.tags, art.is_popular],
    );
  }

  helpSeededVersion = HELP_CONTENT_VERSION;
  return { ok: true };
}

export async function listHelpCategories() {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(a.id)::int AS article_count
     FROM help_categories c
     LEFT JOIN help_articles a ON a.category_slug = c.slug
     WHERE c.slug != 'api'
     GROUP BY c.id ORDER BY c.sort_order ASC`,
  );
  return { ok: true, categories: rows };
}

async function fetchAllArticlesMeta() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.*, c.title AS category_title, c.icon AS category_icon
     FROM help_articles a
     JOIN help_categories c ON c.slug = a.category_slug
     WHERE c.slug != 'api'
     ORDER BY a.is_popular DESC, a.updated_at DESC`,
  );
  return rows.map((r) => mapArticle(r));
}

export async function listHelpArticles({ category, q, popular, limit = 50 } = {}) {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const params = [];
  const where = [`c.slug != 'api'`];
  let n = 1;

  if (category) {
    where.push(`a.category_slug = $${n}`);
    params.push(String(category).trim());
    n += 1;
  }
  if (popular) {
    where.push('a.is_popular = TRUE');
  }
  if (q) {
    const all = await fetchAllArticlesMeta();
    const fuzzy = fuzzySearchArticles(q, all, limit);
    return { ok: true, articles: fuzzy };
  }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  params.push(safeLimit);

  const { rows } = await pool.query(
    `SELECT a.*, c.title AS category_title, c.icon AS category_icon
     FROM help_articles a
     JOIN help_categories c ON c.slug = a.category_slug
     WHERE ${where.join(' AND ')}
     ORDER BY a.is_popular DESC, a.title ASC
     LIMIT $${n}`,
    params,
  );
  return { ok: true, articles: rows.map((r) => mapArticle(r)) };
}

export async function getHelpArticle(slug) {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.*, c.title AS category_title, c.icon AS category_icon
     FROM help_articles a
     JOIN help_categories c ON c.slug = a.category_slug
     WHERE a.slug = $1 LIMIT 1`,
    [String(slug).trim()],
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };
  await pool.query(`UPDATE help_articles SET view_count = view_count + 1 WHERE id = $1`, [rows[0].id]);

  const article = mapArticle(rows[0]);
  let related = [];
  const relatedSlugs = article.body?.related_slugs || [];
  if (relatedSlugs.length) {
    const { rows: relRows } = await pool.query(
      `SELECT a.*, c.title AS category_title, c.icon AS category_icon
       FROM help_articles a
       JOIN help_categories c ON c.slug = a.category_slug
       WHERE a.slug = ANY($1::text[])`,
      [relatedSlugs],
    );
    related = relRows.map((r) => mapArticle(r));
  }
  if (related.length < 3) {
    const { rows: more } = await pool.query(
      `SELECT a.*, c.title AS category_title, c.icon AS category_icon
       FROM help_articles a
       JOIN help_categories c ON c.slug = a.category_slug
       WHERE a.category_slug = $1 AND a.slug != $2
       ORDER BY a.is_popular DESC LIMIT 4`,
      [article.category_slug, article.slug],
    );
    const seen = new Set(related.map((r) => r.slug));
    for (const r of more) {
      if (!seen.has(r.slug) && related.length < 4) {
        related.push(mapArticle(r));
        seen.add(r.slug);
      }
    }
  }

  return { ok: true, article, related };
}

export async function searchHelpForDeflection(query, limit = 8) {
  const q = String(query || '').trim();
  if (q.length < 1) return { ok: true, articles: [] };
  await ensureHelpCenterSeed();
  const all = await fetchAllArticlesMeta();
  return { ok: true, articles: fuzzySearchArticles(q, all, limit) };
}

export async function getRecentlyUpdatedArticles(limit = 6) {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 6));
  const { rows } = await pool.query(
    `SELECT a.*, c.title AS category_title
     FROM help_articles a
     JOIN help_categories c ON c.slug = a.category_slug
     WHERE c.slug != 'api'
     ORDER BY a.updated_at DESC LIMIT $1`,
    [safeLimit],
  );
  return { ok: true, articles: rows.map((r) => mapArticle(r)) };
}
