import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureOperationsV3Schema } from './operations-bootstrap.js';

const CATEGORIES = [
  { slug: 'getting-started', title: 'Getting Started', description: 'Set up your workspace and first project', icon: '🚀', sort_order: 1 },
  { slug: 'exports', title: 'Exports', description: 'Download transcripts, subtitles, and video', icon: '📤', sort_order: 2 },
  { slug: 'transcripts', title: 'Transcripts', description: 'Accuracy, editing, and formatting', icon: '📝', sort_order: 3 },
  { slug: 'translation', title: 'Translation', description: 'Multilingual captions and dubbing', icon: '🌐', sort_order: 4 },
  { slug: 'billing', title: 'Billing', description: 'Plans, invoices, and payments', icon: '💳', sort_order: 5 },
  { slug: 'credits', title: 'Credits', description: 'Usage limits and top-ups', icon: '⚡', sort_order: 6 },
  { slug: 'account', title: 'Account', description: 'Profile, preferences, and teams', icon: '👤', sort_order: 7 },
  { slug: 'security', title: 'Security', description: 'Privacy, data retention, and access', icon: '🔒', sort_order: 8 },
  { slug: 'api', title: 'API', description: 'Integrations and developer access', icon: '🔌', sort_order: 9 },
];

const ARTICLES = [
  {
    slug: 'quick-start-guide',
    category_slug: 'getting-started',
    title: 'Quick start guide',
    summary: 'Paste a link or upload a file to generate your first transcript in minutes.',
    body: 'Open Cutup and choose your source — YouTube, Instagram, or a local file. Run a preview to scan the transcript before exporting. Fix names and numbers in the first minute, then export as SRT or plain text.',
    tags: ['onboarding', 'first project'],
    is_popular: true,
  },
  {
    slug: 'supported-video-formats',
    category_slug: 'getting-started',
    title: 'Supported video formats',
    summary: 'MP4, MOV, WEBM uploads and major social platforms.',
    body: 'Cutup supports direct uploads up to your plan limit plus link-based imports from YouTube and Instagram. For best results use clear audio and minimal background noise.',
    tags: ['formats', 'upload'],
    is_popular: true,
  },
  {
    slug: 'export-srt-subtitles',
    category_slug: 'exports',
    title: 'Export SRT subtitles',
    summary: 'Download broadcast-ready SRT files for your editor.',
    body: 'After reviewing your transcript, open Export and choose SRT. Timing is preserved from the source video. Import the file into Premiere, DaVinci, or Final Cut.',
    tags: ['srt', 'export'],
    is_popular: true,
  },
  {
    slug: 'export-burned-video',
    category_slug: 'exports',
    title: 'Burn-in captions to MP4',
    summary: 'Render captions directly onto your video file.',
    body: 'Use the video export workflow to burn captions with your chosen style. Processing time depends on video length and queue load.',
    tags: ['mp4', 'burn-in'],
    is_popular: false,
  },
  {
    slug: 'improve-transcript-accuracy',
    category_slug: 'transcripts',
    title: 'Improve transcript accuracy',
    summary: 'Tips for cleaner automated transcripts.',
    body: 'Review the first 60 seconds carefully — fix proper nouns once and they propagate. Use punctuation edits to improve readability before sharing with your team.',
    tags: ['accuracy', 'editing'],
    is_popular: true,
  },
  {
    slug: 'translate-captions',
    category_slug: 'translation',
    title: 'Translate captions',
    summary: 'Generate multilingual subtitle tracks from one source.',
    body: 'Run translation after your base transcript is finalized. Choose target languages from the translation panel and export each language as a separate SRT.',
    tags: ['translate', 'languages'],
    is_popular: true,
  },
  {
    slug: 'change-subscription-plan',
    category_slug: 'billing',
    title: 'Change your subscription plan',
    summary: 'Upgrade, downgrade, or switch billing cycle.',
    body: 'Open Dashboard → Plans to compare tiers. Upgrades take effect immediately; downgrades apply at the end of the current billing period.',
    tags: ['plans', 'upgrade'],
    is_popular: true,
  },
  {
    slug: 'understand-credit-usage',
    category_slug: 'credits',
    title: 'Understand credit usage',
    summary: 'How minutes and exports consume credits.',
    body: 'Each transcription and export draws from your monthly credit pool. Check Usage & activity for a breakdown by workflow type.',
    tags: ['credits', 'usage'],
    is_popular: true,
  },
  {
    slug: 'update-profile-settings',
    category_slug: 'account',
    title: 'Update profile settings',
    summary: 'Manage name, email preferences, and country.',
    body: 'Go to Profile & settings in the sidebar. Changes sync to billing and support communications automatically.',
    tags: ['profile'],
    is_popular: false,
  },
  {
    slug: 'data-privacy-retention',
    category_slug: 'security',
    title: 'Data privacy and retention',
    summary: 'How Cutup stores and protects your content.',
    body: 'Uploaded media and transcripts are encrypted at rest. You can request account deletion from Profile settings; deletion is processed within 30 days.',
    tags: ['privacy', 'gdpr'],
    is_popular: false,
  },
  {
    slug: 'api-access-overview',
    category_slug: 'api',
    title: 'API access overview',
    summary: 'Programmatic access for enterprise workflows.',
    body: 'API access is available on Business plans. Contact support to enable keys and review rate limits for your organization.',
    tags: ['api', 'enterprise'],
    is_popular: false,
  },
];

let helpSeeded = false;

function mapArticle(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    category_slug: row.category_slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    tags: row.tags || [],
    is_popular: Boolean(row.is_popular),
    view_count: Number(row.view_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function ensureHelpCenterSeed() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureOperationsV3Schema();
  if (helpSeeded) return { ok: true, cached: true };

  const pool = getPool();
  for (const cat of CATEGORIES) {
    await pool.query(
      `INSERT INTO help_categories (slug, title, description, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order`,
      [cat.slug, cat.title, cat.description, cat.icon, cat.sort_order],
    );
  }
  for (const art of ARTICLES) {
    await pool.query(
      `INSERT INTO help_articles (slug, category_slug, title, summary, body, tags, is_popular)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, body = EXCLUDED.body, tags = EXCLUDED.tags, is_popular = EXCLUDED.is_popular, updated_at = NOW()`,
      [art.slug, art.category_slug, art.title, art.summary, art.body, art.tags, art.is_popular],
    );
  }
  helpSeeded = true;
  return { ok: true };
}

export async function listHelpCategories() {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(a.id)::int AS article_count
     FROM help_categories c
     LEFT JOIN help_articles a ON a.category_slug = c.slug
     GROUP BY c.id ORDER BY c.sort_order ASC`,
  );
  return { ok: true, categories: rows };
}

export async function listHelpArticles({ category, q, popular, limit = 50 } = {}) {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const params = [];
  const where = [];
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
    where.push(`(
      a.title ILIKE $${n} OR a.summary ILIKE $${n} OR $${n + 1} = ANY(a.tags)
    )`);
    const term = `%${String(q).trim()}%`;
    params.push(term, String(q).trim().toLowerCase());
    n += 2;
  }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  params.push(safeLimit);

  const { rows } = await pool.query(
    `SELECT a.*, c.title AS category_title, c.icon AS category_icon
     FROM help_articles a
     JOIN help_categories c ON c.slug = a.category_slug
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.is_popular DESC, a.updated_at DESC
     LIMIT $${n}`,
    params,
  );
  return { ok: true, articles: rows.map(mapArticle) };
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
  return { ok: true, article: mapArticle(rows[0]) };
}

export async function searchHelpForDeflection(query, limit = 5) {
  const q = String(query || '').trim();
  if (q.length < 2) return { ok: true, articles: [] };
  return listHelpArticles({ q, limit });
}

export async function getRecentlyUpdatedArticles(limit = 6) {
  await ensureHelpCenterSeed();
  const pool = getPool();
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 6));
  const { rows } = await pool.query(
    `SELECT a.*, c.title AS category_title
     FROM help_articles a
     JOIN help_categories c ON c.slug = a.category_slug
     ORDER BY a.updated_at DESC LIMIT $1`,
    [safeLimit],
  );
  return { ok: true, articles: rows.map(mapArticle) };
}
