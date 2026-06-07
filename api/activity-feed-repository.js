/**
 * Unified activity timeline — stores important user actions for dashboard feeds.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { PLAN_LABELS } from './plans/permissions.js';

export const ACTIVITY_EVENT_TYPES = {
  TRANSCRIPT_CREATED: 'transcript_created',
  TRANSLATION_CREATED: 'translation_created',
  SUBTITLE_GENERATED: 'subtitle_generated',
  MP4_EXPORT_GENERATED: 'mp4_export_generated',
  OUTPUT_DOWNLOADED: 'output_downloaded',
  PROJECT_DELETED: 'project_deleted',
  PLAN_UPGRADED: 'plan_upgraded',
  SUBSCRIPTION_RENEWED: 'subscription_renewed',
  PAYMENT_SUCCESSFUL: 'payment_successful',
  PAYMENT_FAILED: 'payment_failed',
  CREDITS_RESET: 'credits_reset'
};

export const PROCESSING_EVENT_TYPES = new Set([
  ACTIVITY_EVENT_TYPES.TRANSCRIPT_CREATED,
  ACTIVITY_EVENT_TYPES.TRANSLATION_CREATED,
  ACTIVITY_EVENT_TYPES.SUBTITLE_GENERATED,
  ACTIVITY_EVENT_TYPES.MP4_EXPORT_GENERATED,
  ACTIVITY_EVENT_TYPES.OUTPUT_DOWNLOADED,
  ACTIVITY_EVENT_TYPES.PROJECT_DELETED
]);

export const BILLING_EVENT_TYPES = new Set([
  ACTIVITY_EVENT_TYPES.PLAN_UPGRADED,
  ACTIVITY_EVENT_TYPES.SUBSCRIPTION_RENEWED,
  ACTIVITY_EVENT_TYPES.PAYMENT_SUCCESSFUL,
  ACTIVITY_EVENT_TYPES.PAYMENT_FAILED,
  ACTIVITY_EVENT_TYPES.CREDITS_RESET
]);

const DEFAULT_TITLES = {
  [ACTIVITY_EVENT_TYPES.TRANSCRIPT_CREATED]: 'Transcript Created',
  [ACTIVITY_EVENT_TYPES.TRANSLATION_CREATED]: 'Translation Created',
  [ACTIVITY_EVENT_TYPES.SUBTITLE_GENERATED]: 'Subtitle Generated',
  [ACTIVITY_EVENT_TYPES.MP4_EXPORT_GENERATED]: 'MP4 Export Generated',
  [ACTIVITY_EVENT_TYPES.OUTPUT_DOWNLOADED]: 'Output Downloaded',
  [ACTIVITY_EVENT_TYPES.PROJECT_DELETED]: 'Project Deleted',
  [ACTIVITY_EVENT_TYPES.PLAN_UPGRADED]: 'Plan Upgraded',
  [ACTIVITY_EVENT_TYPES.SUBSCRIPTION_RENEWED]: 'Subscription Renewed',
  [ACTIVITY_EVENT_TYPES.PAYMENT_SUCCESSFUL]: 'Payment Successful',
  [ACTIVITY_EVENT_TYPES.PAYMENT_FAILED]: 'Payment Failed',
  [ACTIVITY_EVENT_TYPES.CREDITS_RESET]: 'Credits Reset'
};

const PROCESSING_OP_TO_EVENT = {
  transcript: ACTIVITY_EVENT_TYPES.TRANSCRIPT_CREATED,
  translation: ACTIVITY_EVENT_TYPES.TRANSLATION_CREATED,
  subtitle: ACTIVITY_EVENT_TYPES.SUBTITLE_GENERATED,
  mp4_export: ACTIVITY_EVENT_TYPES.MP4_EXPORT_GENERATED
};

export function planDisplayName(planKey) {
  const key = String(planKey || 'free').toLowerCase();
  return PLAN_LABELS[key]?.name || key.charAt(0).toUpperCase() + key.slice(1);
}

function formatMoney(amount, currency = 'EUR') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const cur = String(currency || 'EUR').toUpperCase();
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `€${n.toFixed(2)}`;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    eventType: row.event_type,
    title: row.title,
    description: row.description || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function videoDetailFromMetadata(metadata = {}) {
  const title =
    metadata.videoTitle ||
    metadata.title ||
    metadata.projectTitle ||
    metadata.sourceTitle ||
    null;
  if (!title) return null;
  return `Video:\n${title}`;
}

/**
 * @param {string} email
 * @param {string} eventType
 * @param {{ title?: string, description?: string|null, metadata?: object }} [options]
 */
export async function recordActivityEvent(email, eventType, options = {}) {
  if (!isBillingDbConfigured() || !email || !eventType) return null;
  try {
    const title = options.title || DEFAULT_TITLES[eventType] || eventType;
    const description = options.description ?? null;
    const metadata = options.metadata || {};
    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO activity_feed (user_email, event_type, title, description, metadata)
       VALUES (lower($1), $2, $3, $4, $5::jsonb)
       RETURNING id, event_type, title, description, metadata, created_at`,
      [email, eventType, title, description, JSON.stringify(metadata)]
    );
    return mapRow(r.rows[0]);
  } catch (e) {
    console.warn('[activity-feed] record failed', eventType, e?.message || e);
    return null;
  }
}

export function recordProcessingActivityFromCredit(email, operation, metadata = {}) {
  const eventType = PROCESSING_OP_TO_EVENT[operation];
  if (!eventType) return Promise.resolve(null);
  const description = videoDetailFromMetadata(metadata);
  return recordActivityEvent(email, eventType, {
    description,
    metadata: { ...metadata, operation }
  });
}

export function recordOutputDownloaded(email, { format, title, ...rest } = {}) {
  const lines = [];
  if (title) lines.push(`Video:\n${title}`);
  else if (format) lines.push(String(format).toUpperCase());
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.OUTPUT_DOWNLOADED, {
    description: lines.length ? lines.join('\n\n') : null,
    metadata: { format: format || null, title: title || null, ...rest }
  });
}

export function recordProjectDeleted(email, { projectId, title } = {}) {
  const description = title ? `Project:\n${title}` : null;
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.PROJECT_DELETED, {
    description,
    metadata: { projectId: projectId || null, title: title || null }
  });
}

export function recordPlanUpgraded(email, fromPlan, toPlan, metadata = {}) {
  const fromLabel = planDisplayName(fromPlan);
  const toLabel = planDisplayName(toPlan);
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.PLAN_UPGRADED, {
    description: `${fromLabel} → ${toLabel}`,
    metadata: { fromPlan, toPlan, ...metadata }
  });
}

export function recordSubscriptionRenewed(email, planKey, metadata = {}) {
  const plan = planDisplayName(planKey);
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.SUBSCRIPTION_RENEWED, {
    description: plan,
    metadata: { plan: planKey, ...metadata }
  });
}

export function recordPaymentSuccessful(email, { amount, currency, planKey, ...rest } = {}) {
  const money = formatMoney(amount, currency);
  const plan = planDisplayName(planKey);
  const lines = [];
  if (money) lines.push(money);
  if (planKey) lines.push(plan);
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.PAYMENT_SUCCESSFUL, {
    description: lines.join('\n\n') || null,
    metadata: { amount, currency, plan: planKey, ...rest }
  });
}

export function recordPaymentFailed(email, { planKey, reason, ...rest } = {}) {
  const plan = planKey ? planDisplayName(planKey) : null;
  const lines = [];
  if (plan) lines.push(plan);
  if (reason) lines.push(String(reason));
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.PAYMENT_FAILED, {
    description: lines.length ? lines.join('\n\n') : null,
    metadata: { plan: planKey || null, reason: reason || null, ...rest }
  });
}

export function recordCreditsReset(email, metadata = {}) {
  return recordActivityEvent(email, ACTIVITY_EVENT_TYPES.CREDITS_RESET, {
    description: metadata.cycleEnd ? `Next cycle through ${new Date(metadata.cycleEnd).toLocaleDateString('en')}` : null,
    metadata
  });
}

/**
 * @param {string} email
 * @param {{ limit?: number, filter?: 'all'|'processing'|'billing' }} [options]
 */
export async function getActivityFeedDb(email, options = {}) {
  if (!isBillingDbConfigured() || !email) return [];
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 100);
  const filter = options.filter || 'all';

  let typeClause = '';
  const params = [email];
  if (filter === 'processing') {
    typeClause = ` AND event_type = ANY($2::text[])`;
    params.push([...PROCESSING_EVENT_TYPES]);
  } else if (filter === 'billing') {
    typeClause = ` AND event_type = ANY($2::text[])`;
    params.push([...BILLING_EVENT_TYPES]);
  }
  params.push(limit);

  const pool = getPool();
  const r = await pool.query(
    `SELECT id, event_type, title, description, metadata, created_at
     FROM activity_feed
     WHERE lower(user_email) = lower($1)${typeClause}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return r.rows.map(mapRow);
}

export async function getEmailByUserId(userId) {
  if (!userId || !isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query('SELECT email FROM users WHERE id = $1::uuid LIMIT 1', [userId]);
  return r.rows[0]?.email || null;
}
