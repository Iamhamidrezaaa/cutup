/**
 * Content Studio — pages, media, blog extensions, revisions
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import {
  listAdminBlogPostsDb,
  saveAdminBlogPostDb,
  publishAdminBlogPostDb,
  getBlogPostByIdDb
} from './billing-repository.js';
import { syncBlogPostHtml, removeBlogPostHtml } from './blog-publish.js';
import { hydrateCmsPageRecord, getLastHydrationDebug } from './cms-page-hydrate.js';
import { normalizeCmsSections, normalizePagePayload } from './cms-page-normalize.js';
import { getEntityTaxonomyIdsDb, setEntityTaxonomiesDb } from './cms-taxonomy-repository.js';

const CMS_CONTENT_STATUSES = ['draft', 'published', 'scheduled', 'archived', 'trash'];

function isTrashStatus(status) {
  return status === 'trash' || status === 'deleted';
}

function iso(d) {
  if (!d) return null;
  return d.toISOString ? d.toISOString() : d;
}

function mapPage(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    slug: row.slug,
    title: row.title,
    heroTitle: row.hero_title,
    heroSubtitle: row.hero_subtitle,
    content: row.content || '',
    sections: normalizeCmsSections(row.sections),
    template: row.template || 'default',
    status: row.status,
    isHomepage: Boolean(row.is_homepage),
    isSystem: Boolean(row.is_system),
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
    scheduledAt: iso(row.scheduled_at),
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
    publishedBy: row.published_by
  };
}

function mapMedia(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    mediaType: row.media_type,
    fileSize: Number(row.file_size || 0),
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    durationSec: row.duration_sec != null ? Number(row.duration_sec) : null,
    url: row.url,
    altText: row.alt_text,
    caption: row.caption,
    folder: row.folder,
    tags: Array.isArray(row.tags) ? row.tags : [],
    isStarred: Boolean(row.is_starred),
    uploadedBy: row.uploaded_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    usageCount: Number(row.usage_count || 0)
  };
}

function mapBlogRow(row) {
  return {
    id: String(row.id),
    slug: row.slug,
    title: row.title,
    coverImageUrl: row.cover_image_url,
    excerpt: row.excerpt,
    content: row.content,
    contentHtml: row.content_html || null,
    status: row.status,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
    authorEmail: row.author_email,
    readingTimeMinutes: row.reading_time_minutes != null ? Number(row.reading_time_minutes) : null,
    scheduledAt: iso(row.scheduled_at),
    archivedAt: iso(row.archived_at),
    seoTitle: row.seo_title,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: iso(row.published_at),
    htmlPath: row.html_path || null
  };
}

export async function ensureCmsSeedPages() {
  if (!isBillingDbConfigured()) return;
  const pool = getPool();
  const count = await pool.query('SELECT COUNT(*)::int AS c FROM cms_pages');
  if (Number(count.rows[0]?.c || 0) > 0) return;
  const seeds = [
    { slug: 'home', title: 'Homepage', is_homepage: true, is_system: true, template: 'landing' },
    { slug: 'about', title: 'About', is_system: true, template: 'default' },
    { slug: 'contact', title: 'Contact', is_system: true, template: 'default' },
    { slug: 'terms', title: 'Terms of Service', is_system: true, template: 'legal' },
    { slug: 'privacy', title: 'Privacy Policy', is_system: true, template: 'legal' }
  ];
  for (const s of seeds) {
    await pool.query(
      `INSERT INTO cms_pages (slug, title, status, is_homepage, is_system, template)
       VALUES ($1, $2, 'draft', $3, $4, $5)
       ON CONFLICT (slug) DO NOTHING`,
      [s.slug, s.title, Boolean(s.is_homepage), Boolean(s.is_system), s.template]
    );
  }
  await pool.query(
    `UPDATE cms_pages SET status = 'trash', updated_at = NOW()
     WHERE slug IN ('pricing', 'features') AND status NOT IN ('trash', 'deleted')`
  );
}

export async function listCmsPagesDb(opts = {}) {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  const { status, q, limit = 200, trash = false } = opts;
  const params = [];
  const where = [];
  if (trash) {
    where.push(`status IN ('trash', 'deleted')`);
  } else {
    where.push(`status NOT IN ('trash', 'deleted')`);
    where.push(`slug NOT IN ('pricing', 'features')`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(title ILIKE $${params.length} OR slug ILIKE $${params.length})`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const sql = `SELECT * FROM cms_pages ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY is_homepage DESC, updated_at DESC LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  return r.rows.map(mapPage);
}

export async function persistHydratedPageDb(page, editorEmail = 'site-hydrate') {
  if (!page?.id || !page?.slug) return { ok: false, reason: 'missing_id' };
  const payload = normalizePagePayload({
    id: page.id,
    slug: page.slug,
    title: page.title || page.slug,
    heroTitle: page.heroTitle || '',
    heroSubtitle: page.heroSubtitle || '',
    content: page.content || '',
    sections: page.sections,
    template: page.template || 'default',
    status: CMS_CONTENT_STATUSES.includes(page.status) ? page.status : 'draft',
    metaTitle: page.metaTitle || '',
    metaDescription: page.metaDescription || '',
    canonicalUrl: page.canonicalUrl || '',
    ogTitle: page.ogTitle || '',
    ogDescription: page.ogDescription || '',
    ogImageUrl: page.ogImageUrl || '',
    isHomepage: Boolean(page.isHomepage)
  });
  console.log('[CMS Persist]', {
    pageId: page.id,
    slug: page.slug,
    sectionsCount: payload.sections.length,
    blockTypes: payload.sections.map((b) => b.type)
  });
  try {
    await saveCmsPageDb(payload, editorEmail);
    console.log('[CMS Persist] success', { pageId: page.id, slug: page.slug });
    return { ok: true, payload };
  } catch (err) {
    console.error('[CMS Persist] failure', {
      pageId: page.id,
      slug: page.slug,
      message: err?.message,
      stack: err?.stack
    });
    return { ok: false, reason: err?.message || 'persist_failed', payload };
  }
}

export async function getCmsPageDb(idOrSlug, opts = {}) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const key = String(idOrSlug || '').trim();
  if (!key) return null;

  console.log('[CMS] cmsPage load', {
    key,
    hydrate: opts.hydrate !== false,
    persist: opts.persistHydrate,
    force: opts.forceHydrate
  });

  try {
    return await getCmsPageDbInner(pool, key, opts);
  } catch (err) {
    console.error('[CMS] cmsPage fatal', { key, message: err?.message, stack: err?.stack });
    throw err;
  }
}

async function getCmsPageDbInner(pool, key, opts) {

  const r = /^\d+$/.test(key)
    ? await pool.query('SELECT * FROM cms_pages WHERE id = $1::bigint LIMIT 1', [key])
    : await pool.query('SELECT * FROM cms_pages WHERE slug = $1::text LIMIT 1', [key]);
  let page = mapPage(r.rows[0]);
  if (!page) return null;

  console.log('[CMS] cmsPage db', {
    pageId: page.id,
    slug: page.slug,
    sectionsCount: (page.sections || []).length
  });

  if (opts.hydrate !== false) {
    try {
      page = await hydrateCmsPageRecord(page, {
        persist: false,
        force: Boolean(opts.forceHydrate)
      });
      page.sections = normalizeCmsSections(page.sections);
      page._hydrationDebug = getLastHydrationDebug();
      console.log('[CMS Hydrate]', {
        pageId: page.id,
        slug: page.slug,
        parsedBlocks: page.sections.length,
        types: page.sections.map((b) => b.type)
      });

      if (opts.persistHydrate === true && page.sections.length) {
        const persistResult = await persistHydratedPageDb(page);
        page._persistResult = persistResult;
        if (persistResult.ok) {
          const refetch = await pool.query('SELECT * FROM cms_pages WHERE id = $1::bigint LIMIT 1', [
            page.id
          ]);
          if (refetch.rows[0]) page = mapPage(refetch.rows[0]);
        }
      }
    } catch (err) {
      console.error('[CMS Hydrate] error — using DB content', {
        pageId: page.id,
        slug: page.slug,
        message: err?.message,
        stack: err?.stack
      });
      page._hydrationError = err?.message || 'hydrate_failed';
      page.sections = normalizeCmsSections(page.sections);
    }
  }

  if (page.id) {
    try {
      const tax = await getEntityTaxonomyIdsDb('pages', page.id);
      page.categoryIds = tax.categories;
      page.tagIds = tax.tags;
    } catch (err) {
      console.warn('[CMS] taxonomy load skipped', err?.message);
      page.categoryIds = [];
      page.tagIds = [];
    }
  }

  page.sections = normalizeCmsSections(page.sections);
  return page;
}

export async function saveCmsPageDb(payload = {}, editorEmail = '') {
  if (!isBillingDbConfigured()) throw new Error('database_not_configured');
  const pool = getPool();
  const norm = normalizePagePayload(payload);
  const {
    id = null,
    slug,
    title,
    heroTitle,
    heroSubtitle,
    content,
    sections,
    template,
    status,
    metaTitle,
    metaDescription,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImageUrl,
    scheduledAt = payload.scheduledAt ?? null,
    isHomepage = false,
    categoryIds = [],
    tagIds = []
  } = { ...norm, ...payload, sections: normalizeCmsSections(norm.sections) };
  if (!slug || !title) throw new Error('slug_and_title_required');
  const st = CMS_CONTENT_STATUSES.includes(status) ? status : 'draft';
  const sectionsJson = JSON.stringify(sections);
  console.log('[CMS] saveCmsPage', {
    pageId: id || null,
    slug,
    sectionsCount: sections.length,
    blockTypes: sections.map((b) => b.type),
    status: st
  });
  const sched = scheduledAt ? new Date(scheduledAt) : null;
  const pubAt = st === 'published' ? new Date() : null;

  if (isHomepage) {
    await pool.query('UPDATE cms_pages SET is_homepage = FALSE WHERE is_homepage = TRUE');
  }

  const idStr = id != null && String(id).trim() ? String(id).trim() : '';
  if (idStr) {
    const r = await pool.query(
      `UPDATE cms_pages SET
        slug = $2, title = $3, hero_title = $4, hero_subtitle = $5, content = $6,
        sections = $7::jsonb, template = $8, status = $9,
        meta_title = $10, meta_description = $11, canonical_url = $12,
        og_title = $13, og_description = $14, og_image_url = $15,
        scheduled_at = $16, is_homepage = $17,
        updated_at = NOW(), updated_by = $18,
        published_at = CASE WHEN $9 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
        published_by = CASE WHEN $9 = 'published' THEN COALESCE(published_by, $18) ELSE published_by END
       WHERE id = $1::bigint RETURNING id`,
      [
        idStr,
        slug,
        title,
        heroTitle,
        heroSubtitle,
        content,
        sectionsJson,
        template,
        st,
        metaTitle,
        metaDescription,
        canonicalUrl,
        ogTitle,
        ogDescription,
        ogImageUrl,
        sched,
        Boolean(isHomepage),
        editorEmail
      ]
    );
    if (!r.rows.length) throw new Error('page_not_found');
    await savePageRevision(pool, idStr, { ...payload, sections }, editorEmail);
    try {
      await setEntityTaxonomiesDb('pages', idStr, {
        categoryIds: Array.isArray(categoryIds) ? categoryIds : [],
        tagIds: Array.isArray(tagIds) ? tagIds : []
      });
    } catch (err) {
      console.warn('[CMS] taxonomy save skipped', err?.message);
    }
    console.log('[CMS] saveCmsPage success', { pageId: idStr, slug });
    return String(r.rows[0].id);
  }

  const ins = await pool.query(
    `INSERT INTO cms_pages
      (slug, title, hero_title, hero_subtitle, content, sections, template, status,
       meta_title, meta_description, canonical_url, og_title, og_description, og_image_url,
       scheduled_at, is_homepage, published_at, updated_by, published_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      slug,
      title,
      heroTitle,
      heroSubtitle,
      content,
      sectionsJson,
      template,
      st,
      metaTitle,
      metaDescription,
      canonicalUrl,
      ogTitle,
      ogDescription,
      ogImageUrl,
      sched,
      Boolean(isHomepage),
      pubAt,
      editorEmail,
      st === 'published' ? editorEmail : null
    ]
  );
  const newId = String(ins.rows[0].id);
  await savePageRevision(pool, newId, { ...payload, sections }, editorEmail);
  try {
    await setEntityTaxonomiesDb('pages', newId, {
      categoryIds: Array.isArray(categoryIds) ? categoryIds : [],
      tagIds: Array.isArray(tagIds) ? tagIds : []
    });
  } catch (err) {
    console.warn('[CMS] taxonomy save skipped', err?.message);
  }
  return newId;
}

async function savePageRevision(pool, pageId, snapshot, editorEmail) {
  try {
    await pool.query(
      `INSERT INTO cms_page_revisions (page_id, snapshot, created_by) VALUES ($1::bigint, $2::jsonb, $3)`,
      [pageId, JSON.stringify(snapshot), editorEmail || null]
    );
    await pool.query(
      `DELETE FROM cms_page_revisions WHERE page_id = $1::bigint AND id NOT IN (
        SELECT id FROM cms_page_revisions WHERE page_id = $1::bigint ORDER BY created_at DESC LIMIT 30
      )`,
      [pageId]
    );
  } catch {
    /* revisions optional if table missing */
  }
}

export async function duplicateCmsPageDb(id, editorEmail = '') {
  const page = await getCmsPageDb(id);
  if (!page) throw new Error('page_not_found');
  const pool = getPool();
  let slug = `${page.slug}-copy`;
  let n = 2;
  while (true) {
    const ex = await pool.query('SELECT 1 FROM cms_pages WHERE slug = $1 LIMIT 1', [slug]);
    if (!ex.rows.length) break;
    slug = `${page.slug}-copy-${n++}`;
  }
  return saveCmsPageDb(
    {
      ...page,
      id: null,
      slug,
      title: `${page.title} (copy)`,
      status: 'draft',
      isHomepage: false,
      isSystem: false
    },
    editorEmail
  );
}

export async function deleteCmsPageDb(id) {
  return softDeleteCmsPageDb(id);
}

export async function softDeleteCmsPageDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  console.log('[CMS Trash] page', { id });
  const r = await pool.query(
    `UPDATE cms_pages SET
       status_before_trash = CASE
         WHEN status NOT IN ('trash', 'deleted') THEN status
         ELSE status_before_trash
       END,
       status = 'trash',
       updated_at = NOW()
     WHERE id = $1::bigint AND is_system = FALSE AND status NOT IN ('trash', 'deleted')
     RETURNING id`,
    [String(id)]
  );
  return r.rows.length > 0;
}

export async function restoreCmsPageDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE cms_pages SET
       status = COALESCE(NULLIF(status_before_trash, ''), 'draft'),
       status_before_trash = NULL,
       updated_at = NOW()
     WHERE id = $1::bigint AND status IN ('trash', 'deleted')
     RETURNING id`,
    [String(id)]
  );
  return r.rows.length > 0;
}

export async function purgeCmsPageDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query(
    `DELETE FROM cms_pages WHERE id = $1::bigint AND is_system = FALSE RETURNING id`,
    [String(id)]
  );
  return r.rows.length > 0;
}

export async function listPageRevisionsDb(pageId, limit = 20) {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, page_id, created_at, created_by FROM cms_page_revisions
     WHERE page_id = $1::bigint ORDER BY created_at DESC LIMIT $2`,
    [String(pageId), Math.min(Number(limit) || 20, 50)]
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    pageId: String(row.page_id),
    createdAt: iso(row.created_at),
    createdBy: row.created_by
  }));
}

export async function listCmsMediaDb(opts = {}) {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  const { type, q, starred, limit = 200 } = opts;
  const params = [];
  const where = [];
  if (type) {
    params.push(type);
    where.push(`m.media_type = $${params.length}`);
  }
  if (starred === true) where.push('m.is_starred = TRUE');
  if (opts.folder) {
    params.push(String(opts.folder));
    where.push(`m.folder = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(m.original_name ILIKE $${params.length} OR m.filename ILIKE $${params.length})`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const r = await pool.query(
    `SELECT m.*, (SELECT COUNT(*)::int FROM media_usage u WHERE u.media_id = m.id) AS usage_count
     FROM media_library m
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.created_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows.map(mapMedia);
}

export async function getCmsMediaDb(id) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT m.*, (SELECT COUNT(*)::int FROM media_usage u WHERE u.media_id = m.id) AS usage_count
     FROM media_library m WHERE m.id = $1::bigint LIMIT 1`,
    [String(id)]
  );
  return mapMedia(r.rows[0]);
}

export async function insertCmsMediaDb(record) {
  if (!isBillingDbConfigured()) throw new Error('database_not_configured');
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO media_library
      (filename, original_name, mime_type, media_type, file_size, width, height, url, alt_text, folder, tags, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      record.filename,
      record.originalName,
      record.mimeType,
      record.mediaType,
      record.fileSize || 0,
      record.width || null,
      record.height || null,
      record.url,
      record.altText || '',
      record.folder || null,
      Array.isArray(record.tags) ? record.tags : [],
      record.uploadedBy || ''
    ]
  );
  return String(r.rows[0].id);
}

export async function updateCmsMediaMetaDb(id, patch = {}) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE media_library SET
      alt_text = COALESCE($2, alt_text),
      caption = COALESCE($3, caption),
      folder = COALESCE($4, folder),
      tags = COALESCE($5, tags),
      is_starred = COALESCE($6, is_starred),
      updated_at = NOW()
     WHERE id = $1::bigint RETURNING id`,
    [
      String(id),
      patch.altText ?? null,
      patch.caption ?? null,
      patch.folder ?? null,
      patch.tags ?? null,
      patch.isStarred ?? null
    ]
  );
  return r.rows.length > 0;
}

export async function deleteCmsMediaDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query('DELETE FROM media_library WHERE id = $1::bigint RETURNING filename, url', [
    String(id)
  ]);
  return r.rows[0] || null;
}

export async function listAdminBlogPostsEnrichedDb(limit = 200, opts = {}) {
  if (!isBillingDbConfigured()) {
    const posts = await listAdminBlogPostsDb(limit);
    return posts;
  }
  const pool = getPool();
  const trash = Boolean(opts.trash);
  const whereTrash = trash
    ? `WHERE status IN ('trash', 'deleted')`
    : `WHERE status NOT IN ('trash', 'deleted')`;
  try {
    const r = await pool.query(
      `SELECT * FROM blog_posts ${whereTrash} ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 200, 1), 500)]
    );
    return r.rows.map(mapBlogRow);
  } catch {
    return listAdminBlogPostsDb(limit);
  }
}

export async function saveAdminBlogPostEnrichedDb(payload, editorEmail = '') {
  let previousSlug = null;
  if (payload.id) {
    const existing = await getBlogPostByIdDb(payload.id);
    previousSlug = existing?.slug || null;
  }
  const readingTime = estimateReadingTime(payload.content);
  const extended = {
    ...payload,
    readingTimeMinutes: readingTime
  };
  const normStatus = normalizeBlogStatus(extended.status);
  const id = await saveAdminBlogPostDb({
    id: extended.id,
    slug: extended.slug,
    title: extended.title,
    coverImageUrl: extended.coverImageUrl,
    excerpt: extended.excerpt,
    content: extended.content,
    status: normStatus,
    category: extended.category,
    tags: extended.tags,
    metaTitle: extended.seoTitle || extended.metaTitle,
    metaDescription: extended.metaDescription,
    canonicalUrl: extended.canonicalUrl,
    ogTitle: extended.ogTitle,
    ogDescription: extended.ogDescription
  });
  if (!isBillingDbConfigured()) return id;
  const pool = getPool();
  try {
    await pool.query(
      `UPDATE blog_posts SET
        author_email = COALESCE($2, author_email),
        reading_time_minutes = $3,
        scheduled_at = $4,
        og_image_url = $5,
        updated_by = $6,
        seo_title = $7,
        archived_at = CASE WHEN $8 = 'archived' THEN COALESCE(archived_at, NOW()) ELSE NULL END
       WHERE id = $1::bigint`,
      [
        id,
        extended.authorEmail || editorEmail || null,
        readingTime,
        extended.scheduledAt ? new Date(extended.scheduledAt) : null,
        extended.ogImageUrl || '',
        editorEmail || null,
        extended.seoTitle || extended.metaTitle || '',
        normStatus
      ]
    );
    await pool.query('UPDATE blog_posts SET status = $2::text WHERE id = $1::bigint', [id, normStatus]);
    if (extended.contentHtml !== undefined) {
      try {
        await pool.query('UPDATE blog_posts SET content_html = $2::text WHERE id = $1::bigint', [
          id,
          extended.contentHtml || null
        ]);
      } catch {
        /* content_html column may not exist before migration */
      }
    }
    await saveBlogRevision(pool, id, extended, editorEmail);
  } catch {
    /* extended columns may be missing on old DB */
  }
  try {
    await syncBlogPostHtml(id);
    if (previousSlug && previousSlug !== extended.slug) {
      await removeBlogPostHtml(previousSlug);
    }
  } catch (err) {
    console.error('[blog] sync html failed:', extended.slug, err?.message);
  }
  return id;
}

function normalizeBlogStatus(status) {
  const s = String(status || 'draft').toLowerCase();
  if (s === 'deleted') return 'trash';
  if (CMS_CONTENT_STATUSES.includes(s)) return s;
  return 'draft';
}

function estimateReadingTime(content) {
  const words = String(content || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

async function saveBlogRevision(pool, postId, snapshot, editorEmail) {
  try {
    await pool.query(
      `INSERT INTO blog_post_revisions (post_id, snapshot, created_by) VALUES ($1::bigint, $2::jsonb, $3)`,
      [postId, JSON.stringify(snapshot), editorEmail || null]
    );
  } catch {
    /* optional */
  }
}

export async function duplicateBlogPostDb(id, editorEmail = '') {
  const posts = await listAdminBlogPostsEnrichedDb(500, { trash: false });
  const post = posts.find((p) => String(p.id) === String(id));
  if (!post) throw new Error('post_not_found');
  let slug = `${post.slug}-copy`;
  let n = 2;
  const pool = getPool();
  while (true) {
    const ex = await pool.query('SELECT 1 FROM blog_posts WHERE slug = $1 LIMIT 1', [slug]);
    if (!ex.rows.length) break;
    slug = `${post.slug}-copy-${n++}`;
  }
  return saveAdminBlogPostEnrichedDb(
    {
      ...post,
      id: null,
      slug,
      title: `${post.title} (copy)`,
      status: 'draft'
    },
    editorEmail
  );
}

export async function softDeleteBlogPostDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  console.log('[CMS Trash] post', { id });
  const r = await pool.query(
    `UPDATE blog_posts SET
       status_before_trash = CASE
         WHEN status NOT IN ('trash', 'deleted') THEN status
         ELSE status_before_trash
       END,
       status = 'trash',
       updated_at = NOW()
     WHERE id = $1::bigint AND status NOT IN ('trash', 'deleted')
     RETURNING id, slug`,
    [String(id)]
  );
  if (r.rows[0]?.slug) await removeBlogPostHtml(r.rows[0].slug);
  return r.rows.length > 0;
}

export async function restoreBlogPostDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE blog_posts SET
       status = COALESCE(NULLIF(status_before_trash, ''), 'draft'),
       status_before_trash = NULL,
       updated_at = NOW(),
       archived_at = NULL
     WHERE id = $1::bigint AND status IN ('trash', 'deleted')
     RETURNING id`,
    [String(id)]
  );
  if (r.rows.length) {
    try {
      await syncBlogPostHtml(id);
    } catch (err) {
      console.warn('[blog] restore sync html:', err?.message);
    }
  }
  return r.rows.length > 0;
}

export async function purgeBlogPostDb(id) {
  if (!isBillingDbConfigured()) return false;
  const pool = getPool();
  const r = await pool.query('DELETE FROM blog_posts WHERE id = $1::bigint RETURNING id, slug', [
    String(id)
  ]);
  if (r.rows[0]?.slug) await removeBlogPostHtml(r.rows[0].slug);
  return r.rows.length > 0;
}

export async function listBlogRevisionsDb(postId, limit = 20) {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT id, post_id, created_at, created_by FROM blog_post_revisions
       WHERE post_id = $1::bigint ORDER BY created_at DESC LIMIT $2`,
      [String(postId), Math.min(Number(limit) || 20, 50)]
    );
    return r.rows.map((row) => ({
      id: String(row.id),
      postId: String(row.post_id),
      createdAt: iso(row.created_at),
      createdBy: row.created_by
    }));
  } catch {
    return [];
  }
}

export async function listBlogCategoriesDb() {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  try {
    const r = await pool.query('SELECT slug, name FROM blog_categories ORDER BY name ASC');
    return r.rows;
  } catch {
    const posts = await listAdminBlogPostsDb(500);
    const set = new Set();
    posts.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return [...set].map((name) => ({ slug: name, name }));
  }
}

export async function getCmsInsightsDb() {
  const insights = { duplicateSlugs: [], orphanPages: [], missingAltMedia: 0 };
  if (!isBillingDbConfigured()) return insights;
  const pool = getPool();
  try {
    const dup = await pool.query(
      `SELECT slug, COUNT(*)::int AS c FROM blog_posts GROUP BY slug HAVING COUNT(*) > 1`
    );
    insights.duplicateSlugs = dup.rows.map((r) => r.slug);
    const orphans = await pool.query(
      `SELECT slug FROM cms_pages WHERE status = 'draft' AND updated_at < NOW() - INTERVAL '90 days'`
    );
    insights.orphanPages = orphans.rows.map((r) => r.slug);
    const alt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM media_library WHERE COALESCE(alt_text, '') = '' AND media_type = 'image'`
    );
    insights.missingAltMedia = Number(alt.rows[0]?.c || 0);
  } catch {
    /* noop */
  }
  return insights;
}

export { listAdminBlogPostsDb, saveAdminBlogPostDb, publishAdminBlogPostDb };
