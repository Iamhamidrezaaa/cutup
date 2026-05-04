import { spawnSync } from 'child_process';
import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import {
  getPool,
  isBillingDbConfigured
} from './db/pool.js';
import {
  getAdminOverviewDb,
  getAdminUsersDb,
  getAdminUsageDb,
  getAdminSavedOutputsDb,
  getAdminPaymentsSnapshotDb,
  getAdminPricingAbMetricsDb,
  listAdminBlogPostsDb,
  saveAdminBlogPostDb,
  publishAdminBlogPostDb
} from './billing-repository.js';
import { listAdminsDb, insertAdminDb, updateAdminDb, ensureAdminsSchema } from './admins-repository.js';

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

function safeCmdExists(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, { timeout: 2000, encoding: 'utf8' });
    if (result.error) return false;
    return result.status === 0;
  } catch {
    return false;
  }
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

  const action = req.query?.action || req.body?.action;
  try {
    if (req.method === 'GET' && action === 'blogPosts' && String(req.query?.public || '') === '1') {
      const posts = await listAdminBlogPostsDb(req.query.limit || 300);
      const published = posts
        .filter((p) => p.status === 'published')
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          coverImageUrl: sanitizeBlogCoverImageUrl(p.coverImageUrl),
          excerpt: p.excerpt,
          content: p.content,
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
      const overview = await getAdminOverviewDb();
      return res.json({
        ...overview,
        revenue: null,
        revenueNote: 'Revenue reporting requires Stripe event sync.'
      });
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
      const data = await getAdminUsageDb({
        type: req.query.type || 'all',
        platform: req.query.platform || 'all',
        startDate: req.query.startDate || '',
        endDate: req.query.endDate || '',
        limit: req.query.limit || 300
      });
      return res.json({ activities: data, total: data.length });
    }

    if (req.method === 'GET' && action === 'savedOutputs') {
      if (!requireOpsAccess(auth, res)) return;
      const data = await getAdminSavedOutputsDb({
        limit: req.query.limit || 300
      });
      return res.json({ outputs: data, total: data.length });
    }

    if (req.method === 'GET' && action === 'payments') {
      if (!requireOpsAccess(auth, res)) return;
      const snapshot = await getAdminPaymentsSnapshotDb();
      return res.json({
        ...snapshot,
        stripeConfig: {
          STRIPE_SECRET_KEY: boolConfigured('STRIPE_SECRET_KEY'),
          STRIPE_WEBHOOK_SECRET: boolConfigured('STRIPE_WEBHOOK_SECRET'),
          STRIPE_PRICE_STARTER: boolConfigured('STRIPE_PRICE_STARTER'),
          STRIPE_PRICE_PRO: boolConfigured('STRIPE_PRICE_PRO'),
          STRIPE_PRICE_ADVANCED: boolConfigured('STRIPE_PRICE_ADVANCED')
        },
        revenue: null,
        revenueNote: 'Revenue reporting requires Stripe event sync.'
      });
    }

    if (req.method === 'GET' && action === 'pricingAb') {
      if (!requireOpsAccess(auth, res)) return;
      const metrics = await getAdminPricingAbMetricsDb();
      return res.json(metrics);
    }

    if (req.method === 'GET' && action === 'health') {
      if (!requireOpsAccess(auth, res)) return;
      const db = await dbHealth();
      const events = await getAdminUsageDb({ limit: 20 });
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
          ytdlp: safeCmdExists('yt-dlp', ['--version']),
          ffmpeg: safeCmdExists('ffmpeg', ['-version'])
        },
        recentEvents: events.slice(0, 20),
        checkedBy: auth.email
      });
    }

    if (req.method === 'GET' && action === 'admins') {
      if (!requireSuperAdmin(auth, res)) return;
      const rows = await listAdminsDb();
      return res.json({ admins: rows, total: rows.length });
    }

    if (req.method === 'POST' && action === 'createAdmin') {
      if (!requireSuperAdmin(auth, res)) return;
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const email = String(raw.email || '').trim().toLowerCase();
      const password = String(raw.password || '');
      const role = String(raw.role || 'admin').trim();
      if (!email || !password) {
        return res.status(400).json({ error: 'email and password required' });
      }
      if (!['super_admin', 'admin', 'editor'].includes(role)) {
        return res.status(400).json({ error: 'invalid role' });
      }
      try {
        const row = await insertAdminDb(email, password, role);
        return res.json({ success: true, admin: row });
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
      const id = await saveAdminBlogPostDb(payload);
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
      if (publish) {
        triggerGoogleSitemapPing();
      }
      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('[admin] error:', error);
    return res.status(500).json({
      error: 'Admin request failed. Please try again.',
      message: error?.message || 'unknown_error'
    });
  }
}
