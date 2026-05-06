/**
 * CMS taxonomies — pages & posts (categories + tags).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { tableExists } from './admin-db-safe.js';

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function mapTax(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    contentType: row.content_type,
    taxonomyKind: row.taxonomy_kind,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    parentId: row.parent_id != null ? String(row.parent_id) : null,
    count: Number(row.usage_count || 0),
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export async function ensureCmsTaxonomySchema() {
  if (!isBillingDbConfigured()) return;
  const { readFileSync } = await import('fs');
  const { dirname, join } = await import('path');
  const { fileURLToPath } = await import('url');
  const dir = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(dir, 'db', 'schema-cms-taxonomy.sql'), 'utf8');
  await getPool().query(sql);
}

export async function ensureCmsTaxonomySeed() {
  if (!isBillingDbConfigured()) return;
  await ensureCmsTaxonomySchema();
  const pool = getPool();
  const seeds = [
    { content_type: 'pages', taxonomy_kind: 'category', name: 'Marketing', slug: 'marketing', description: 'Promotional and conversion pages' },
    { content_type: 'pages', taxonomy_kind: 'category', name: 'Legal', slug: 'legal', description: 'Terms, privacy, compliance' },
    { content_type: 'pages', taxonomy_kind: 'category', name: 'System', slug: 'system', description: 'Core site pages' },
    { content_type: 'pages', taxonomy_kind: 'category', name: 'Landing', slug: 'landing', description: 'Landing and homepage layouts' },
    { content_type: 'pages', taxonomy_kind: 'category', name: 'Company', slug: 'company', description: 'About, contact, team' },
    { content_type: 'pages', taxonomy_kind: 'tag', name: 'homepage', slug: 'homepage' },
    { content_type: 'pages', taxonomy_kind: 'tag', name: 'seo', slug: 'seo' },
    { content_type: 'pages', taxonomy_kind: 'tag', name: 'conversion', slug: 'conversion' },
    { content_type: 'pages', taxonomy_kind: 'tag', name: 'ai', slug: 'ai' },
    { content_type: 'pages', taxonomy_kind: 'tag', name: 'pricing', slug: 'pricing' },
    { content_type: 'pages', taxonomy_kind: 'tag', name: 'onboarding', slug: 'onboarding' },
    { content_type: 'posts', taxonomy_kind: 'category', name: 'Guides', slug: 'guides' },
    { content_type: 'posts', taxonomy_kind: 'category', name: 'Tutorials', slug: 'tutorials' },
    { content_type: 'posts', taxonomy_kind: 'category', name: 'AI', slug: 'ai' },
    { content_type: 'posts', taxonomy_kind: 'category', name: 'Marketing', slug: 'marketing' },
    { content_type: 'posts', taxonomy_kind: 'category', name: 'Product Updates', slug: 'product-updates' },
    { content_type: 'posts', taxonomy_kind: 'category', name: 'Case Studies', slug: 'case-studies' }
  ];
  for (const s of seeds) {
    await pool.query(
      `INSERT INTO cms_taxonomies (content_type, taxonomy_kind, name, slug, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (content_type, taxonomy_kind, slug) DO NOTHING`,
      [s.content_type, s.taxonomy_kind, s.name, s.slug, s.description || null]
    );
  }
}

export async function listCmsTaxonomiesDb(opts = {}) {
  if (!isBillingDbConfigured()) return [];
  await ensureCmsTaxonomySeed();
  const pool = getPool();
  const { contentType, taxonomyKind, q } = opts;
  const params = [];
  const where = ['1=1'];
  if (contentType) {
    params.push(contentType);
    where.push(`t.content_type = $${params.length}`);
  }
  if (taxonomyKind) {
    params.push(taxonomyKind);
    where.push(`t.taxonomy_kind = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length})`);
  }
  const entityTable = contentType === 'posts' ? 'blog_posts' : 'cms_pages';
  const sql = `
    SELECT t.*,
      (SELECT COUNT(*)::int FROM cms_content_taxonomy ct
       WHERE ct.taxonomy_id = t.id
         AND ct.content_type = t.content_type
         AND EXISTS (
           SELECT 1 FROM ${entityTable} e
           WHERE e.id = ct.entity_id AND e.status NOT IN ('trash', 'deleted')
         )
      ) AS usage_count
    FROM cms_taxonomies t
    WHERE ${where.join(' AND ')}
    ORDER BY t.taxonomy_kind, t.name`;
  const r = await pool.query(sql, params);
  return r.rows.map(mapTax);
}

export async function saveCmsTaxonomyDb(payload = {}) {
  if (!isBillingDbConfigured()) throw new Error('database_not_configured');
  const pool = getPool();
  const {
    id = null,
    contentType,
    taxonomyKind,
    name,
    slug: slugIn,
    description = '',
    parentId = null
  } = payload;
  if (!contentType || !taxonomyKind || !name) throw new Error('taxonomy_fields_required');
  const slug = slugify(slugIn || name);
  const parent = parentId ? Number(parentId) : null;

  if (id) {
    const r = await pool.query(
      `UPDATE cms_taxonomies SET
        name = $2, slug = $3, description = $4, parent_id = $5, updated_at = NOW()
       WHERE id = $1::bigint AND content_type = $6 AND taxonomy_kind = $7
       RETURNING *`,
      [id, name, slug, description || null, parent, contentType, taxonomyKind]
    );
    if (!r.rows[0]) throw new Error('taxonomy_not_found');
    const list = await listCmsTaxonomiesDb({ contentType, taxonomyKind });
    return list.find((x) => x.id === String(id)) || mapTax(r.rows[0]);
  }

  const r = await pool.query(
    `INSERT INTO cms_taxonomies (content_type, taxonomy_kind, name, slug, description, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (content_type, taxonomy_kind, slug)
     DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
       parent_id = EXCLUDED.parent_id, updated_at = NOW()
     RETURNING *`,
    [contentType, taxonomyKind, name, slug, description || null, parent]
  );
  const row = r.rows[0];
  const list = await listCmsTaxonomiesDb({ contentType, taxonomyKind });
  return list.find((x) => x.id === String(row.id)) || mapTax(row);
}

export async function deleteCmsTaxonomyDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query('DELETE FROM cms_taxonomies WHERE id = $1::bigint RETURNING id', [id]);
  return Boolean(r.rows[0]);
}

export async function mergeCmsTaxonomyDb(sourceId, targetId) {
  if (!isBillingDbConfigured()) throw new Error('database_not_configured');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query('SELECT * FROM cms_taxonomies WHERE id = $1::bigint', [sourceId]);
    const tgt = await client.query('SELECT * FROM cms_taxonomies WHERE id = $2::bigint', [targetId]);
    if (!src.rows[0] || !tgt.rows[0]) throw new Error('taxonomy_not_found');
    if (
      src.rows[0].content_type !== tgt.rows[0].content_type ||
      src.rows[0].taxonomy_kind !== tgt.rows[0].taxonomy_kind
    ) {
      throw new Error('taxonomy_merge_type_mismatch');
    }
    await client.query(
      `INSERT INTO cms_content_taxonomy (content_type, entity_id, taxonomy_id)
       SELECT content_type, entity_id, $2::bigint FROM cms_content_taxonomy WHERE taxonomy_id = $1::bigint
       ON CONFLICT (content_type, taxonomy_kind, slug) DO NOTHING`,
      [sourceId, targetId]
    );
    await client.query('DELETE FROM cms_content_taxonomy WHERE taxonomy_id = $1::bigint', [sourceId]);
    await client.query('DELETE FROM cms_taxonomies WHERE id = $1::bigint', [sourceId]);
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getEntityTaxonomyIdsDb(contentType, entityId) {
  if (!isBillingDbConfigured()) return { categories: [], tags: [] };
  const pool = getPool();
  if (!(await tableExists(pool, 'cms_content_taxonomy'))) return { categories: [], tags: [] };
  const r = await pool.query(
    `SELECT t.id, t.taxonomy_kind, t.slug, t.name
     FROM cms_content_taxonomy ct
     JOIN cms_taxonomies t ON t.id = ct.taxonomy_id
     WHERE ct.content_type = $1 AND ct.entity_id = $2::bigint`,
    [contentType, entityId]
  );
  const categories = [];
  const tags = [];
  for (const row of r.rows) {
    if (row.taxonomy_kind === 'category') categories.push(String(row.id));
    else tags.push(String(row.id));
  }
  return { categories, tags };
}

export async function setEntityTaxonomiesDb(contentType, entityId, { categoryIds = [], tagIds = [] } = {}) {
  if (!isBillingDbConfigured()) return;
  const pool = getPool();
  if (!(await tableExists(pool, 'cms_content_taxonomy'))) return;
  const ids = [...categoryIds, ...tagIds].map(Number).filter(Boolean);
  await pool.query(
    `DELETE FROM cms_content_taxonomy WHERE content_type = $1 AND entity_id = $2::bigint`,
    [contentType, entityId]
  );
  for (const tid of ids) {
    await pool.query(
      `INSERT INTO cms_content_taxonomy (content_type, entity_id, taxonomy_id)
       VALUES ($1, $2::bigint, $3::bigint) ON CONFLICT DO NOTHING`,
      [contentType, entityId, tid]
    );
  }
}
