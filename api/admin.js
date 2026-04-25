import { spawnSync } from 'child_process';
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
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
  listAdminBlogPostsDb,
  saveAdminBlogPostDb,
  publishAdminBlogPostDb
} from './billing-repository.js';

function parseAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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

function getSessionAndAdminEmail(req, res) {
  const sessionId = req.headers['x-session-id'] || req.query?.session || req.body?.session;
  if (!sessionId) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session || !session.user?.email) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    res.status(401).json({ error: 'Session expired' });
    return null;
  }
  const email = String(session.user.email || '').toLowerCase();
  const admins = parseAdminEmails();
  if (!admins.includes(email)) {
    res.status(403).json({ error: 'You do not have admin access.' });
    return null;
  }
  return email;
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
      [['users', 'subscriptions', 'usage', 'usage_history', 'saved_outputs', 'blog_posts']]
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
        blog_posts: existing.has('blog_posts')
      }
    };
  } catch {
    return { connected: false, tables: {} };
  }
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Service is not configured yet.' });
  }

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

    const adminEmail = getSessionAndAdminEmail(req, res);
    if (!adminEmail) return;

    if (req.method === 'GET' && action === 'overview') {
      const overview = await getAdminOverviewDb();
      return res.json({
        ...overview,
        revenue: null,
        revenueNote: 'Revenue reporting requires Stripe event sync.'
      });
    }

    if (req.method === 'GET' && action === 'users') {
      const data = await getAdminUsersDb({
        search: req.query.search || '',
        plan: req.query.plan || 'all',
        limit: req.query.limit || 200
      });
      return res.json({ users: data, total: data.length });
    }

    if (req.method === 'GET' && action === 'usage') {
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
      const data = await getAdminSavedOutputsDb({
        limit: req.query.limit || 300
      });
      return res.json({ outputs: data, total: data.length });
    }

    if (req.method === 'GET' && action === 'payments') {
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

    if (req.method === 'GET' && action === 'health') {
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
        checkedBy: adminEmail
      });
    }

    if (req.method === 'GET' && action === 'blogPosts') {
      const posts = await listAdminBlogPostsDb(req.query.limit || 200);
      return res.json({ posts, total: posts.length });
    }

    if (req.method === 'POST' && action === 'saveBlogPost') {
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
      const id = req.body?.id;
      const publish = Boolean(req.body?.publish);
      if (!id) return res.status(400).json({ error: 'id is required' });
      const nextStatus = publish ? 'published' : 'draft';
      console.log('[admin-blog] publish target', { id, status: nextStatus });
      const ok = await publishAdminBlogPostDb(id, publish);
      if (!ok) return res.status(404).json({ error: 'Post not found' });
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
