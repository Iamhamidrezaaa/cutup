/**
 * Content Studio — schema detection and idempotent bootstrap (non-destructive).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { tableExists, clearTableExistsCache, isMissingRelationError } from './admin-db-safe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimum tables for Pages workspace */
export const CMS_PAGES_TABLES = ['cms_pages'];

/** Minimum tables for Library workspace */
export const CMS_MEDIA_TABLES = ['media_library'];

/** All Content Studio extension tables (from schema-cms.sql) */
export const CMS_EXTENSION_TABLES = [
  'cms_pages',
  'cms_page_revisions',
  'blog_post_revisions',
  'blog_categories',
  'blog_tags',
  'media_library',
  'media_usage',
  'cms_taxonomies',
  'cms_content_taxonomy'
];

let ensurePromise = null;
let lastBootstrapResult = null;

/**
 * @param {string[]} tableNames
 */
export async function tablesReady(tableNames) {
  if (!isBillingDbConfigured()) {
    return {
      ok: false,
      setupRequired: true,
      reason: 'db_not_configured',
      missingTables: [...tableNames]
    };
  }
  const pool = getPool();
  const missingTables = [];
  for (const name of tableNames) {
    if (!(await tableExists(pool, name))) missingTables.push(name);
  }
  return {
    ok: missingTables.length === 0,
    setupRequired: missingTables.length > 0,
    missingTables
  };
}

/** @returns {Promise<{ ok: boolean, setupRequired: boolean, missingTables: string[], blogPostsAvailable?: boolean }>} */
export async function cmsSchemaReady() {
  const ext = await tablesReady(CMS_EXTENSION_TABLES);
  let blogPostsAvailable = false;
  if (isBillingDbConfigured()) {
    blogPostsAvailable = await tableExists(getPool(), 'blog_posts');
  }
  return {
    ...ext,
    blogPostsAvailable
  };
}

export function cmsSetupPayload(status = {}) {
  return {
    ok: false,
    setupRequired: true,
    missingTables: status.missingTables || CMS_EXTENSION_TABLES,
    reason: status.reason || 'schema_not_initialized',
    message:
      'The CMS database structure has not been initialized yet. Run migrations to enable Pages, Blog, and Library features.',
    bootstrapAttempted: Boolean(status.bootstrapAttempted),
    bootstrapOk: status.bootstrapOk ?? null
  };
}

/**
 * Idempotent CREATE IF NOT EXISTS from schema-cms.sql
 */
export async function ensureCmsSchema() {
  if (!isBillingDbConfigured()) {
    lastBootstrapResult = { ok: false, reason: 'db_not_configured' };
    return lastBootstrapResult;
  }
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const pool = getPool();
    const blogExists = await tableExists(pool, 'blog_posts');
    if (!blogExists) {
      lastBootstrapResult = {
        ok: false,
        reason: 'blog_posts_missing',
        error: 'Core blog_posts table is required before CMS extensions can be applied.'
      };
      return lastBootstrapResult;
    }

    try {
      const sqlPath = join(__dirname, 'db', 'schema-cms.sql');
      const sql = readFileSync(sqlPath, 'utf8');
      await pool.query(sql);
      const taxPath = join(__dirname, 'db', 'schema-cms-taxonomy.sql');
      const taxSql = readFileSync(taxPath, 'utf8');
      await pool.query(taxSql);
      const softPath = join(__dirname, 'db', 'schema-cms-soft-delete.sql');
      await pool.query(readFileSync(softPath, 'utf8'));
      const trashPath = join(__dirname, 'db', 'schema-cms-status-trash.sql');
      await pool.query(readFileSync(trashPath, 'utf8'));
      clearTableExistsCache();
      const ready = await cmsSchemaReady();
      lastBootstrapResult = {
        ok: ready.ok,
        reason: ready.ok ? 'applied' : 'partial',
        missingTables: ready.missingTables
      };
      return lastBootstrapResult;
    } catch (err) {
      console.warn('[cms-bootstrap] ensureCmsSchema failed:', err?.message || err);
      clearTableExistsCache();
      lastBootstrapResult = {
        ok: false,
        reason: isMissingRelationError(err) ? 'dependency_missing' : 'bootstrap_failed',
        error: 'CMS schema could not be applied automatically. Run database migrations manually.'
      };
      return lastBootstrapResult;
    } finally {
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}

/** Which tables an admin action needs */
const ACTION_TABLES = {
  cmsPages: CMS_PAGES_TABLES,
  cmsPage: CMS_PAGES_TABLES,
  saveCmsPage: CMS_PAGES_TABLES,
  duplicateCmsPage: CMS_PAGES_TABLES,
  deleteCmsPage: CMS_PAGES_TABLES,
  restoreCmsPage: CMS_PAGES_TABLES,
  purgeCmsPage: CMS_PAGES_TABLES,
  cmsPageRevisions: CMS_PAGES_TABLES,
  cmsMedia: CMS_MEDIA_TABLES,
  cmsMediaItem: CMS_MEDIA_TABLES,
  updateCmsMedia: CMS_MEDIA_TABLES,
  deleteCmsMedia: CMS_MEDIA_TABLES,
  syncCmsMedia: CMS_MEDIA_TABLES,
  blogPostsEnriched: ['blog_posts'],
  saveBlogPostEnriched: ['blog_posts'],
  duplicateBlogPost: ['blog_posts'],
  softDeleteBlogPost: ['blog_posts'],
  restoreBlogPost: ['blog_posts'],
  purgeBlogPost: ['blog_posts'],
  regenerateBlogHtml: ['blog_posts'],
  importEditorialBlogPosts: ['blog_posts'],
  blogRevisions: ['blog_post_revisions'],
  blogCategories: ['blog_categories'],
  cmsTaxonomies: ['cms_taxonomies'],
  saveCmsTaxonomy: ['cms_taxonomies'],
  deleteCmsTaxonomy: ['cms_taxonomies', 'cms_content_taxonomy'],
  mergeCmsTaxonomy: ['cms_taxonomies', 'cms_content_taxonomy'],
  cmsInsights: CMS_EXTENSION_TABLES
};

/**
 * @param {string} action
 * @param {{ tryBootstrap?: boolean }} [opts]
 */
export async function guardCmsAction(action, opts = {}) {
  const required = ACTION_TABLES[action] || CMS_EXTENSION_TABLES;
  let status = await tablesReady(required);

  if (status.setupRequired && opts.tryBootstrap !== false) {
    const boot = await ensureCmsSchema();
    status = await tablesReady(required);
    if (status.setupRequired) {
      return {
        blocked: true,
        body: cmsSetupPayload({
          ...status,
          bootstrapAttempted: true,
          bootstrapOk: boot.ok
        })
      };
    }
  }

  if (status.setupRequired) {
    return { blocked: true, body: cmsSetupPayload(status) };
  }

  return { blocked: false, body: null };
}

export function isCmsSetupError(err) {
  if (!err) return false;
  if (isMissingRelationError(err)) {
    const msg = String(err.message || '');
    return /cms_|media_library|blog_post_revisions|blog_categories|blog_tags|media_usage/i.test(msg);
  }
  return false;
}
