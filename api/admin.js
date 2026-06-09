import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import {
  getPool,
  isBillingDbConfigured
} from './db/pool.js';
import {
  getAdminOverviewDb,
  getAdminUsersDb,
  adminCreateCustomerUser,
  getAdminUsageDb,
  getAdminSavedOutputsDb,
  getAdminPaymentsSnapshotDb,
  getAdminPaymentsAnalyticsDb,
  getAdminPricingAbMetricsDb,
  listInvoicesByEmail,
  listAdminBlogPostsDb,
  saveAdminBlogPostDb,
  publishAdminBlogPostDb,
  getBlogPostByIdDb
} from './billing-repository.js';
import { syncBlogPostHtml, removeBlogPostHtml } from './blog-publish.js';
import { listAdminsDb, insertAdminDb, updateAdminDb, ensureAdminsSchema } from './admins-repository.js';
import {
  getAdminProfilesMap,
  upsertAdminProfile,
  ensureAdminProfileSeed
} from './admin-profiles-repository.js';
import { ensurePaymentAttemptsSchema } from './payment-attempts-bootstrap.js';
import { getAdminOverviewDashboardDb } from './admin-overview-repository.js';
import { getAdminUsageDashboardDb, normalizeUsageActivityRow } from './admin-usage-repository.js';
import {
  getAdminOutputsDashboardDb,
  getAdminSavedOutputDetailDb,
  bulkAdminSavedOutputsDb
} from './admin-outputs-repository.js';
import {
  getAdminPaymentsDashboardDb,
  getAdminPaymentDetailDb,
  getPaymentInfrastructureDb,
  adminPaymentActionDb
} from './admin-payments-repository.js';
import { getAdminOpsHealthDb } from './admin-health-repository.js';
import { checkFfmpegHealth, checkYtDlpHealth } from './media-tool-health.js';
import { getAdminAiStateDashboardDb } from './admin-ai-state-repository.js';
import {
  guardCmsAction,
  cmsSchemaReady,
  ensureCmsSchema,
  cmsSetupPayload,
  isCmsSetupError
} from './cms-bootstrap.js';
import {
  ensureCmsSeedPages,
  listCmsPagesDb,
  getCmsPageDb,
  saveCmsPageDb,
  duplicateCmsPageDb,
  deleteCmsPageDb,
  restoreCmsPageDb,
  purgeCmsPageDb,
  listPageRevisionsDb,
  listCmsMediaDb,
  getCmsMediaDb,
  updateCmsMediaMetaDb,
  deleteCmsMediaDb,
  listAdminBlogPostsEnrichedDb,
  saveAdminBlogPostEnrichedDb,
  duplicateBlogPostDb,
  softDeleteBlogPostDb,
  restoreBlogPostDb,
  purgeBlogPostDb,
  listBlogRevisionsDb,
  listBlogCategoriesDb,
  getCmsInsightsDb
} from './admin-cms-repository.js';
import {
  listCmsTaxonomiesDb,
  saveCmsTaxonomyDb,
  deleteCmsTaxonomyDb,
  mergeCmsTaxonomyDb,
  ensureCmsTaxonomySeed
} from './cms-taxonomy-repository.js';
import { syncCmsMediaLibrary } from './admin-cms-media-sync.js';
import { getLastHydrationDebug } from './cms-page-hydrate.js';

/** Fire-and-forget sitemap ping after blog publish (does not block admin response). */
function triggerGoogleSitemapPing() {
  const base = (process.env.PUBLIC_SITE_URL || 'https://cutup.shop').replace(/\/$/, '');
  const url = `${base}/api/ping-google`;
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 8000);
  fetch(url, { signal: ac.signal })
    .catch(() => {})
    .finally(() => clearTimeout(tid));
}

/** Only http(s) cover URLs; strips javascript:, data:, etc. */
function sanitizeBlogCoverImageUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href.slice(0, 2048);
  } catch {
    return '';
  }
}

/** Cookie-based panel auth (separate from end-user Google sessions). */
async function getAdminPanelAuth(req, res) {
  const auth = await resolveAdminAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return { email: auth.email, role: auth.role, adminId: auth.adminId };
}

function requireBlogAccess(auth, res) {
  if (!auth || !['editor', 'admin', 'super_admin'].includes(auth.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

function requireOpsAccess(auth, res) {
  if (!auth || !['admin', 'super_admin'].includes(auth.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

function requireSuperAdmin(auth, res) {
  if (!auth || auth.role !== 'super_admin') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

function boolConfigured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

async function dbHealth() {
  if (!isBillingDbConfigured()) {
    return { connected: false, tables: {} };
  }
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    const tableRes = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['users', 'subscriptions', 'usage', 'usage_history', 'saved_outputs', 'blog_posts', 'admins', 'admin_sessions', 'audit_events']]
    );
    const existing = new Set(tableRes.rows.map((r) => r.table_name));
    return {
      connected: true,
      tables: {
        users: existing.has('users'),
        subscriptions: existing.has('subscriptions'),
        usage: existing.has('usage'),
        usage_history: existing.has('usage_history'),
        saved_outputs: existing.has('saved_outputs'),
        blog_posts: existing.has('blog_posts'),
        admins: existing.has('admins'),
        admin_sessions: existing.has('admin_sessions'),
        audit_events: existing.has('audit_events')
      }
    };
  } catch {
    return { connected: false, tables: {} };
  }
}

export default async function handler(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Service is not configured yet.' });
  }
  await ensureAdminsSchema();
  try {
    await ensurePaymentAttemptsSchema();
  } catch (e) {
    console.warn('[admin] payment_attempts bootstrap', e?.message || e);
  }
  try {
    await ensureCmsSchema();
  } catch (e) {
    console.warn('[admin] cms bootstrap', e?.message || e);
  }

  const action = req.query?.action || req.body?.action;
  const CMS_GUARDED_ACTIONS = new Set([
    'cmsPages',
    'cmsPage',
    'saveCmsPage',
    'duplicateCmsPage',
    'deleteCmsPage',
    'restoreCmsPage',
    'purgeCmsPage',
    'cmsPageRevisions',
    'cmsMedia',
    'cmsMediaItem',
    'updateCmsMedia',
    'deleteCmsMedia',
    'syncCmsMedia',
    'blogPostsEnriched',
    'saveBlogPostEnriched',
    'duplicateBlogPost',
    'softDeleteBlogPost',
    'restoreBlogPost',
    'purgeBlogPost',
    'regenerateBlogHtml',
    'importEditorialBlogPosts',
    'blogRevisions',
    'blogCategories',
    'cmsTaxonomies',
    'saveCmsTaxonomy',
    'deleteCmsTaxonomy',
    'mergeCmsTaxonomy',
    'cmsInsights'
  ]);
  try {
    if (req.method === 'GET' && action === 'blogPosts' && String(req.query?.public || '') === '1') {
      const posts = await listAdminBlogPostsDb(req.query.limit || 300);
      const published = posts
        .filter((p) => p.status === 'published' && p.status !== 'trash' && p.status !== 'deleted')
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          coverImageUrl: sanitizeBlogCoverImageUrl(p.coverImageUrl),
          excerpt: p.excerpt,
          content: p.content,
          contentHtml: p.contentHtml || null,
          status: p.status,
          category: p.category,
          tags: p.tags || [],
          metaTitle: p.metaTitle,
          metaDescription: p.metaDescription,
          canonicalUrl: p.canonicalUrl,
          ogTitle: p.ogTitle,
          ogDescription: p.ogDescription,
          publishedAt: p.publishedAt,
          updatedAt: p.updatedAt
        }));
      return res.json({ posts: published, total: published.length });
    }

    const auth = await getAdminPanelAuth(req, res);
    if (!auth) return;

    if (req.method === 'GET' && action === 'overview') {
      if (!requireOpsAccess(auth, res)) return;
      const period = String(req.query.period || '30d').trim();
      const [legacy, dashboard] = await Promise.all([
        getAdminOverviewDb(),
        getAdminOverviewDashboardDb(period).catch((err) => {
          console.error('[admin overview dashboard]', err);
          return null;
        })
      ]);
      const revTotal = dashboard?.revenue?.total ?? null;
      return res.json({
        ...legacy,
        period,
        revenue: revTotal,
        revenueNote: revTotal == null ? 'Revenue reporting requires database connection.' : '',
        dashboard
      });
    }

    if (req.method === 'POST' && action === 'createCustomer') {
      if (!requireOpsAccess(auth, res)) return;
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const email = String(raw.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'email required' });
      try {
        const result = await adminCreateCustomerUser({
          email,
          first_name: raw.first_name,
          last_name: raw.last_name,
          phone: raw.phone,
          country: raw.country,
          plan: raw.plan || 'free',
          extend_days: raw.extend_days,
          extend_months: raw.extend_months
        });
        if (!result.ok) {
          const code =
            result.error === 'email_taken' || result.error === 'email_is_admin'
              ? 409
              : result.error === 'invalid_email' || result.error === 'invalid_plan'
                ? 400
                : 400;
          return res.status(code).json({ error: result.error || 'create_failed' });
        }
        return res.json({ success: true, user: result.user ?? null });
      } catch (e) {
        console.error('[admin] createCustomer', e);
        return res.status(500).json({ error: 'create_failed', message: e?.message || 'unknown' });
      }
    }

    if (req.method === 'GET' && action === 'users') {
      if (!requireOpsAccess(auth, res)) return;
      try {
        const data = await getAdminUsersDb({
          search: req.query.search || '',
          plan: req.query.plan || 'all',
          limit: req.query.limit || 200
        });
        return res.json({ users: data, total: data.length });
      } catch (err) {
        console.error('ADMIN USERS ERROR:', err);
        return res.status(500).json({ error: err?.message || 'users_fetch_failed' });
      }
    }

    if (req.method === 'GET' && action === 'usage') {
      if (!requireOpsAccess(auth, res)) return;
      const legacyOnly = String(req.query.legacy || '') === '1';
      if (legacyOnly) {
        const data = await getAdminUsageDb({
          type: req.query.type || 'all',
          platform: req.query.platform || 'all',
          startDate: req.query.startDate || '',
          endDate: req.query.endDate || '',
          limit: req.query.limit || 300
        });
        return res.json({ activities: data, total: data.length });
      }
      try {
        const dashboard = await getAdminUsageDashboardDb({
          preset: req.query.preset || 'all',
          startDate: req.query.startDate || '',
          endDate: req.query.endDate || '',
          type: req.query.type || 'all',
          platform: req.query.platform || 'all',
          plan: req.query.plan || 'all',
          country: req.query.country || 'all',
          search: req.query.search || '',
          page: req.query.page || 1,
          pageSize: req.query.pageSize || 100,
          sort: req.query.sort || 'created_at',
          sortDir: req.query.sortDir || 'desc'
        });
        let activities = dashboard.activities || [];
        if (!activities.length && !req.query.preset) {
          const legacy = await getAdminUsageDb({
            type: req.query.type || 'all',
            platform: req.query.platform || 'all',
            startDate: '',
            endDate: '',
            limit: Math.min(Number(req.query.pageSize) || 100, 300)
          });
          activities = legacy.map((row) => normalizeUsageActivityRow(row)).filter(Boolean);
        }
        return res.json({
          activities,
          total: dashboard.total || activities.length,
          page: dashboard.page || 1,
          pageSize: dashboard.pageSize || 100,
          totalPages: dashboard.totalPages || 1,
          analytics: dashboard.analytics,
          insights: dashboard.insights || [],
          debug: dashboard.debug || null
        });
      } catch (err) {
        console.error('[admin usage dashboard]', err);
        const data = await getAdminUsageDb({
          type: req.query.type || 'all',
          platform: req.query.platform || 'all',
          startDate: req.query.startDate || '',
          endDate: req.query.endDate || '',
          limit: req.query.limit || 300
        });
        const activities = data.map((row) => normalizeUsageActivityRow(row)).filter(Boolean);
        return res.json({
          activities,
          total: activities.length,
          page: 1,
          pageSize: activities.length,
          totalPages: 1,
          analytics: null,
          insights: [],
          debug: { fallback: 'legacy_query', rowsFetched: activities.length, error: err?.message }
        });
      }
    }

    if (req.method === 'GET' && action === 'savedOutput') {
      if (!requireOpsAccess(auth, res)) return;
      const detail = await getAdminSavedOutputDetailDb(req.query.id);
      if (!detail) return res.status(404).json({ error: 'Output not found' });
      return res.json({ output: detail });
    }

    if (req.method === 'GET' && action === 'savedOutputs') {
      if (!requireOpsAccess(auth, res)) return;
      const legacyOnly = String(req.query.legacy || '') === '1';
      if (legacyOnly) {
        const data = await getAdminSavedOutputsDb({
          limit: req.query.limit || 300
        });
        return res.json({ outputs: data, total: data.length });
      }
      try {
        const dashboard = await getAdminOutputsDashboardDb({
          preset: req.query.preset || 'all',
          startDate: req.query.startDate || '',
          endDate: req.query.endDate || '',
          type: req.query.type || 'all',
          platform: req.query.platform || 'all',
          language: req.query.language || 'all',
          plan: req.query.plan || 'all',
          search: req.query.search || '',
          favoritesOnly: req.query.favoritesOnly || '',
          highLength: req.query.highLength || '',
          aiHeavy: req.query.aiHeavy || '',
          showArchived: req.query.showArchived || '',
          page: req.query.page || 1,
          pageSize: req.query.pageSize || 50,
          sort: req.query.sort || 'created_at',
          sortDir: req.query.sortDir || 'desc'
        });
        return res.json({
          outputs: dashboard.outputs,
          total: dashboard.total,
          page: dashboard.page,
          pageSize: dashboard.pageSize,
          totalPages: dashboard.totalPages,
          analytics: dashboard.analytics,
          insights: dashboard.insights || [],
          debug: dashboard.debug || null
        });
      } catch (err) {
        console.error('[admin savedOutputs dashboard]', err);
        const data = await getAdminSavedOutputsDb({ limit: req.query.limit || 300 });
        return res.json({
          outputs: data,
          total: data.length,
          page: 1,
          pageSize: data.length,
          totalPages: 1,
          analytics: null,
          insights: [],
          debug: { fallback: 'legacy', error: err?.message }
        });
      }
    }

    if (req.method === 'POST' && action === 'bulkSavedOutputs') {
      if (!requireOpsAccess(auth, res)) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await bulkAdminSavedOutputsDb({
        operation: body.operation,
        ids: body.ids || []
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    }

    if (req.method === 'GET' && action === 'payment') {
      if (!requireOpsAccess(auth, res)) return;
      const detail = await getAdminPaymentDetailDb(req.query.id);
      if (!detail) return res.status(404).json({ error: 'Payment not found' });
      return res.json({ detail });
    }

    if (req.method === 'GET' && action === 'payments') {
      if (!requireOpsAccess(auth, res)) return;
      const legacyOnly = String(req.query.legacy || '') === '1';
      if (legacyOnly) {
        const [snapshot, analytics] = await Promise.all([
          getAdminPaymentsSnapshotDb(),
          getAdminPaymentsAnalyticsDb({
            startDate: req.query.startDate || '',
            endDate: req.query.endDate || '',
            plan: req.query.plan || 'all',
            status: req.query.status || 'all',
            userId: req.query.userId || ''
          })
        ]);
        return res.json({
          ...snapshot,
          ...analytics,
          stripeConfig: {
            STRIPE_SECRET_KEY: boolConfigured('STRIPE_SECRET_KEY'),
            STRIPE_WEBHOOK_SECRET: boolConfigured('STRIPE_WEBHOOK_SECRET')
          }
        });
      }
      try {
        const dashboard = await getAdminPaymentsDashboardDb({
          preset: req.query.preset || '30d',
          startDate: req.query.startDate || '',
          endDate: req.query.endDate || '',
          provider: req.query.provider || 'all',
          status: req.query.status || 'all',
          callbackStatus: req.query.callbackStatus || 'all',
          plan: req.query.plan || 'all',
          country: req.query.country || 'all',
          search: req.query.search || '',
          minAmount: req.query.minAmount || '',
          maxAmount: req.query.maxAmount || '',
          failedOnly: req.query.failedOnly || '',
          retriesOnly: req.query.retriesOnly || '',
          highValueOnly: req.query.highValueOnly || '',
          sandboxOnly: req.query.sandboxOnly || '',
          liveOnly: req.query.liveOnly || '',
          page: req.query.page || 1,
          pageSize: req.query.pageSize || 50,
          grain: req.query.grain || 'day'
        });
        return res.json(dashboard);
      } catch (err) {
        console.error('[admin payments dashboard]', err);
        const analytics = await getAdminPaymentsAnalyticsDb({
          startDate: req.query.startDate || '',
          endDate: req.query.endDate || '',
          plan: req.query.plan || 'all',
          status: req.query.status || 'all'
        });
        return res.json({
          ...analytics,
          infrastructure: await getPaymentInfrastructureDb(),
          insights: [],
          debug: { fallback: 'legacy_analytics', error: err?.message }
        });
      }
    }

    if (req.method === 'POST' && action === 'paymentAction') {
      if (!requireOpsAccess(auth, res)) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await adminPaymentActionDb({
        operation: body.operation,
        paymentId: body.paymentId,
        note: body.note
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    }

    if (req.method === 'GET' && action === 'paymentUserHistory') {
      if (!requireOpsAccess(auth, res)) return;
      const email = String(req.query.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'email_required' });
      const invoices = await listInvoicesByEmail(email, req.query.limit || 100);
      const analytics = await getAdminPaymentsAnalyticsDb({
        startDate: req.query.startDate || '',
        endDate: req.query.endDate || '',
        plan: 'all',
        status: 'all'
      });
      const payments = (analytics.payments || []).filter((p) => String(p.email || '').toLowerCase() === email);
      return res.json({ email, payments, invoices });
    }

    if (req.method === 'GET' && action === 'pricingAb') {
      if (!requireOpsAccess(auth, res)) return;
      const metrics = await getAdminPricingAbMetricsDb();
      return res.json(metrics);
    }

    if (req.method === 'GET' && action === 'aiState') {
      if (!requireOpsAccess(auth, res)) return;
      try {
        const dashboard = await getAdminAiStateDashboardDb({
          preset: req.query.preset || '24h'
        });
        return res.json(dashboard);
      } catch (err) {
        console.error('[admin aiState]', err);
        return res.json({
          partial: true,
          fatal: true,
          checkedAt: new Date().toISOString(),
          telemetryWarnings: [
            { id: 'dashboard', message: 'AI operations dashboard is temporarily unavailable.' }
          ],
          kpis: null,
          pipelines: [],
          cost: null,
          queue: { available: false, message: 'Queue telemetry not yet available.' },
          incidents: [],
          cronJobs: [],
          models: null,
          insights: [{ tone: 'warn', text: 'AI operations dashboard is temporarily unavailable.' }]
        });
      }
    }

    if (req.method === 'GET' && action === 'health') {
      if (!requireOpsAccess(auth, res)) return;
      const legacyOnly = String(req.query.legacy || '') === '1';
      if (legacyOnly) {
        const db = await dbHealth();
        const events = await getAdminUsageDb({ limit: 20 });
        const [ffLegacy, ytLegacy] = await Promise.all([checkFfmpegHealth(), checkYtDlpHealth()]);
        return res.json({
          api: 'ok',
          database: db,
          envReadiness: {
            DATABASE_URL: boolConfigured('DATABASE_URL'),
            OPENAI_API_KEY: boolConfigured('OPENAI_API_KEY'),
            STRIPE_SECRET_KEY: boolConfigured('STRIPE_SECRET_KEY'),
            STRIPE_WEBHOOK_SECRET: boolConfigured('STRIPE_WEBHOOK_SECRET')
          },
          tools: {
            ytdlp: ytLegacy.status === 'operational',
            ffmpeg: ffLegacy.status === 'operational',
            ffmpegTelemetry: ffLegacy,
            ytdlpTelemetry: ytLegacy
          },
          recentEvents: events.slice(0, 20),
          checkedBy: auth.email
        });
      }
      const snapshot = await getAdminOpsHealthDb();
      return res.json(snapshot);
    }

    if (req.method === 'GET' && action === 'admins') {
      if (!requireSuperAdmin(auth, res)) return;
      const rows = await listAdminsDb();
      const profiles = await getAdminProfilesMap(rows.map((r) => r.id));
      const admins = rows.map((r) => ({
        ...r,
        profile: profiles[Number(r.id)] || null
      }));
      return res.json({ admins, total: admins.length });
    }

    if (req.method === 'POST' && action === 'createAdmin') {
      if (!requireSuperAdmin(auth, res)) return;
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const email = String(raw.email || '').trim().toLowerCase();
      const password = String(raw.password || '');
      const role = String(raw.role || 'admin').trim();
      const nickname = String(raw.nickname || raw.displayName || '').trim();
      if (!email || !password) {
        return res.status(400).json({ error: 'email and password required' });
      }
      if (!['super_admin', 'admin', 'editor'].includes(role)) {
        return res.status(400).json({ error: 'invalid role' });
      }
      try {
        const row = await insertAdminDb(email, password, role);
        let profile = null;
        if (nickname.length >= 2) {
          const saved = await upsertAdminProfile(row.id, { displayName: nickname });
          profile = saved.ok ? saved.profile : null;
        } else {
          profile = await ensureAdminProfileSeed(row.id, email);
        }
        return res.json({ success: true, admin: { ...row, profile } });
      } catch (e) {
        if (e.code === '23505') {
          return res.status(409).json({ error: 'Email already exists' });
        }
        throw e;
      }
    }

    if (req.method === 'POST' && action === 'updateAdmin') {
      if (!requireSuperAdmin(auth, res)) return;
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const id = raw.id;
      if (id == null) return res.status(400).json({ error: 'id required' });
      const role = raw.role != null ? String(raw.role).trim() : null;
      const status = raw.status != null ? String(raw.status).trim() : null;
      if (role && !['super_admin', 'admin', 'editor'].includes(role)) {
        return res.status(400).json({ error: 'invalid role' });
      }
      if (status && !['active', 'disabled'].includes(status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      const targetId = Number(id);
      if (status === 'disabled' && Number.isFinite(targetId) && targetId === auth.adminId) {
        return res.status(400).json({ error: 'Cannot disable your own account' });
      }
      await updateAdminDb(id, { role: role || undefined, status: status || undefined });
      return res.json({ success: true });
    }

    if (req.method === 'GET' && action === 'blogPosts') {
      if (!requireBlogAccess(auth, res)) return;
      const posts = await listAdminBlogPostsDb(req.query.limit || 200);
      return res.json({ posts, total: posts.length });
    }

    if (req.method === 'POST' && action === 'saveBlogPost') {
      if (!requireBlogAccess(auth, res)) return;
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const rawId = raw.id != null && String(raw.id).trim() !== '' ? String(raw.id).trim() : null;
      const payload = {
        id: rawId,
        slug: String(raw.slug || '').trim(),
        title: String(raw.title || '').trim(),
        excerpt: String(raw.excerpt || ''),
        content: String(raw.content || ''),
        status: raw.status === 'published' ? 'published' : 'draft',
        category: String(raw.category || '').trim(),
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        metaTitle: String(raw.metaTitle || ''),
        metaDescription: String(raw.metaDescription || ''),
        canonicalUrl: String(raw.canonicalUrl || ''),
        ogTitle: String(raw.ogTitle || ''),
        ogDescription: String(raw.ogDescription || ''),
        coverImageUrl: sanitizeBlogCoverImageUrl(raw.coverImageUrl)
      };
      if (!payload.slug) return res.status(400).json({ error: 'Slug is required', message: 'Please enter a slug.' });
      if (!payload.title) return res.status(400).json({ error: 'Title is required', message: 'Please enter a title.' });
      console.log('[admin] saveBlogPost request', {
        id: payload.id,
        slug: payload.slug,
        status: payload.status,
        titleLength: payload.title.length,
        contentLength: payload.content.length,
        category: payload.category,
        tagsCount: payload.tags.length
      });
      let previousSlug = null;
      if (payload.id) {
        const existing = await getBlogPostByIdDb(payload.id);
        previousSlug = existing?.slug || null;
      }
      const id = await saveAdminBlogPostDb(payload);
      try {
        await syncBlogPostHtml(id);
        if (previousSlug && previousSlug !== payload.slug) {
          await removeBlogPostHtml(previousSlug);
        }
      } catch (err) {
        console.error('[admin] blog html sync failed:', err?.message);
      }
      return res.json({ success: true, id });
    }

    if (req.method === 'POST' && action === 'publishBlogPost') {
      if (!requireBlogAccess(auth, res)) return;
      const id = req.body?.id;
      const publish = Boolean(req.body?.publish);
      if (!id) return res.status(400).json({ error: 'id is required' });
      const nextStatus = publish ? 'published' : 'draft';
      console.log('[admin-blog] publish target', { id, status: nextStatus });
      const ok = await publishAdminBlogPostDb(id, publish);
      if (!ok) return res.status(404).json({ error: 'Post not found' });
      try {
        await syncBlogPostHtml(id);
      } catch (err) {
        console.error('[admin] blog html sync after publish:', err?.message);
      }
      if (publish) {
        triggerGoogleSitemapPing();
      }
      return res.json({ success: true });
    }

    if (req.method === 'GET' && action === 'cmsSetupStatus') {
      if (!requireBlogAccess(auth, res)) return;
      let ready = await cmsSchemaReady();
      let bootstrap = null;
      if (ready.setupRequired) {
        bootstrap = await ensureCmsSchema();
        ready = await cmsSchemaReady();
      }
      return res.json({
        ok: ready.ok,
        setupRequired: ready.setupRequired,
        missingTables: ready.missingTables || [],
        blogPostsAvailable: ready.blogPostsAvailable,
        bootstrap
      });
    }

    if (req.method === 'POST' && action === 'cmsBootstrap') {
      if (!requireBlogAccess(auth, res)) return;
      const bootstrap = await ensureCmsSchema();
      const ready = await cmsSchemaReady();
      return res.json({
        ok: ready.ok,
        setupRequired: ready.setupRequired,
        missingTables: ready.missingTables || [],
        blogPostsAvailable: ready.blogPostsAvailable,
        bootstrap
      });
    }

    if (CMS_GUARDED_ACTIONS.has(action)) {
      if (!requireBlogAccess(auth, res)) return;
      const guard = await guardCmsAction(action);
      if (guard.blocked) return res.status(200).json(guard.body);
    }

    if (req.method === 'GET' && action === 'cmsPages') {
      await ensureCmsSeedPages();
      const pages = await listCmsPagesDb({
        status: req.query.trash === '1' ? '' : req.query.status || '',
        q: req.query.q || '',
        limit: req.query.limit || 200,
        trash: req.query.trash === '1'
      });
      return res.json({ pages, total: pages.length });
    }

    if (req.method === 'GET' && action === 'cmsPage') {
      const pageKey = req.query.id || req.query.slug;
      try {
        const page = await getCmsPageDb(pageKey, {
          hydrate: req.query.hydrate !== '0',
          persistHydrate: req.query.persist === '1',
          forceHydrate: req.query.force === '1'
        });
        if (!page) return res.status(404).json({ error: 'Page not found' });
        const hydrationDebug = page._hydrationDebug;
        const hydrationError = page._hydrationError || null;
        const persistResult = page._persistResult || null;
        delete page._hydrationDebug;
        delete page._hydrationError;
        delete page._persistResult;
        return res.json({ page, hydrationDebug, hydrationError, persistResult });
      } catch (err) {
        console.error('[CMS] cmsPage handler error', {
          pageKey,
          message: err?.message,
          stack: err?.stack
        });
        try {
          const fallback = await getCmsPageDb(pageKey, {
            hydrate: false,
            persistHydrate: false,
            forceHydrate: false
          });
          if (fallback) {
            fallback._hydrationError = err?.message || 'hydrate_failed';
            const hydrationError = fallback._hydrationError;
            delete fallback._hydrationDebug;
            delete fallback._hydrationError;
            delete fallback._persistResult;
            return res.json({
              page: fallback,
              hydrationError,
              hydrationDebug: getLastHydrationDebug() || null
            });
          }
        } catch (inner) {
          console.error('[CMS] cmsPage fallback failed', inner?.message);
        }
        return res.status(200).json({
          page: null,
          hydrationError: err?.message || 'cms_page_failed',
          error: err?.message || 'cms_page_failed'
        });
      }
    }

    if (req.method === 'GET' && action === 'cmsTaxonomies') {
      await ensureCmsTaxonomySeed();
      const contentType = req.query.contentType === 'posts' ? 'posts' : 'pages';
      const taxonomyKind =
        req.query.kind === 'tag' || req.query.taxonomyKind === 'tag' ? 'tag' : 'category';
      const items = await listCmsTaxonomiesDb({
        contentType,
        taxonomyKind,
        q: req.query.q || ''
      });
      return res.json({ taxonomies: items, total: items.length });
    }

    if (req.method === 'POST' && action === 'saveCmsTaxonomy') {
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const item = await saveCmsTaxonomyDb(raw);
      return res.json({ success: true, taxonomy: item });
    }

    if (req.method === 'POST' && action === 'deleteCmsTaxonomy') {
      const ok = await deleteCmsTaxonomyDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Could not delete taxonomy' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'POST' && action === 'mergeCmsTaxonomy') {
      await mergeCmsTaxonomyDb(req.body?.sourceId, req.body?.targetId);
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'saveCmsPage') {
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const id = await saveCmsPageDb(raw, auth.email || '');
      return res.json({ success: true, id });
    }

    if (req.method === 'POST' && action === 'duplicateCmsPage') {
      const id = await duplicateCmsPageDb(req.body?.id, auth.email || '');
      return res.json({ success: true, id });
    }

    if (req.method === 'POST' && action === 'deleteCmsPage') {
      const ok = await deleteCmsPageDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Cannot move page to trash' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'POST' && action === 'restoreCmsPage') {
      const ok = await restoreCmsPageDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Could not restore page' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'POST' && action === 'purgeCmsPage') {
      if (!requireSuperAdmin(auth, res)) return;
      const ok = await purgeCmsPageDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Could not permanently delete page' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'GET' && action === 'cmsPageRevisions') {
      const revisions = await listPageRevisionsDb(req.query.pageId, req.query.limit || 20);
      return res.json({ revisions });
    }

    if (req.method === 'GET' && action === 'cmsMedia') {
      const media = await listCmsMediaDb({
        type: req.query.type || '',
        q: req.query.q || '',
        folder: req.query.folder || '',
        starred: req.query.starred === '1',
        limit: req.query.limit || 500
      });
      return res.json({ media, total: media.length });
    }

    if (req.method === 'POST' && action === 'syncCmsMedia') {
      const result = await syncCmsMediaLibrary({ uploadedBy: auth.email || 'sync' });
      return res.json({ success: true, ...result });
    }

    if (req.method === 'GET' && action === 'cmsMediaItem') {
      const item = await getCmsMediaDb(req.query.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      return res.json({ media: item });
    }

    if (req.method === 'POST' && action === 'updateCmsMedia') {
      const ok = await updateCmsMediaMetaDb(req.body?.id, req.body?.patch || req.body);
      return res.json({ success: ok });
    }

    if (req.method === 'POST' && action === 'deleteCmsMedia') {
      const row = await deleteCmsMediaDb(req.body?.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.json({ success: true, filename: row.filename });
    }

    if (req.method === 'GET' && action === 'blogPostsEnriched') {
      const posts = await listAdminBlogPostsEnrichedDb(req.query.limit || 200, {
        trash: req.query.trash === '1'
      });
      return res.json({ posts, total: posts.length });
    }

    if (req.method === 'POST' && action === 'saveBlogPostEnriched') {
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const payload = {
        id: raw.id != null && String(raw.id).trim() !== '' ? String(raw.id).trim() : null,
        slug: String(raw.slug || '').trim(),
        title: String(raw.title || '').trim(),
        excerpt: String(raw.excerpt || ''),
        content: String(raw.content || ''),
        status: raw.status || 'draft',
        category: String(raw.category || '').trim(),
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        metaTitle: String(raw.metaTitle || raw.seoTitle || ''),
        seoTitle: String(raw.seoTitle || raw.metaTitle || ''),
        metaDescription: String(raw.metaDescription || ''),
        canonicalUrl: String(raw.canonicalUrl || ''),
        ogTitle: String(raw.ogTitle || ''),
        ogDescription: String(raw.ogDescription || ''),
        ogImageUrl: String(raw.ogImageUrl || ''),
        coverImageUrl: sanitizeBlogCoverImageUrl(raw.coverImageUrl),
        authorEmail: String(raw.authorEmail || auth.email || ''),
        scheduledAt: raw.scheduledAt || null,
        contentHtml: raw.contentHtml != null ? String(raw.contentHtml) : undefined
      };
      if (!payload.slug) return res.status(400).json({ error: 'Slug is required' });
      if (!payload.title) return res.status(400).json({ error: 'Title is required' });
      const id = await saveAdminBlogPostEnrichedDb(payload, auth.email || '');
      if (payload.status === 'published') triggerGoogleSitemapPing();
      return res.json({ success: true, id });
    }

    if (req.method === 'POST' && action === 'duplicateBlogPost') {
      const id = await duplicateBlogPostDb(req.body?.id, auth.email || '');
      return res.json({ success: true, id });
    }

    if (req.method === 'POST' && action === 'softDeleteBlogPost') {
      const ok = await softDeleteBlogPostDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Could not move post to trash' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'POST' && action === 'restoreBlogPost') {
      const ok = await restoreBlogPostDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Could not restore post' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'POST' && action === 'purgeBlogPost') {
      if (!requireSuperAdmin(auth, res)) return;
      const ok = await purgeBlogPostDb(req.body?.id);
      if (!ok) return res.status(400).json({ error: 'Could not permanently delete post' });
      return res.json({ success: true, ok: true });
    }

    if (req.method === 'POST' && action === 'regenerateBlogHtml') {
      const target = req.body?.id || req.body?.slug;
      if (!target) return res.status(400).json({ error: 'id_or_slug_required' });
      const result = await syncBlogPostHtml(target);
      if (!result.ok) return res.status(400).json(result);
      return res.json({ success: true, ...result });
    }

    if (req.method === 'POST' && action === 'importEditorialBlogPosts') {
      const { importEditorialBlogPostsToDb } = await import('./blog-import-editorial.js');
      const result = await importEditorialBlogPostsToDb();
      return res.json({ success: result.ok, ...result });
    }

    if (req.method === 'GET' && action === 'blogRevisions') {
      const revisions = await listBlogRevisionsDb(req.query.postId, req.query.limit || 20);
      return res.json({ revisions });
    }

    if (req.method === 'GET' && action === 'blogCategories') {
      const categories = await listBlogCategoriesDb();
      return res.json({ categories });
    }

    if (req.method === 'GET' && action === 'cmsInsights') {
      const insights = await getCmsInsightsDb();
      return res.json({ insights });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('[admin] error:', error);
    if (isCmsSetupError(error)) {
      const ready = await cmsSchemaReady();
      return res.status(200).json(
        cmsSetupPayload({ ...ready, bootstrapAttempted: false })
      );
    }
    return res.status(500).json({
      error: 'Admin request failed. Please try again.',
      message: error?.message || 'Something went wrong. Please try again.',
      detail: String(error?.message || error)
    });
  }
}
