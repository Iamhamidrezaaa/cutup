/**
 * Unified processing-credits engine.
 * DB column usage.minutes_used stores monthly-cycle credits used (legacy name preserved).
 */
import { getPool } from './db/pool.js';
import { getPlanDef, resolvePlanKey } from './plans-config.js';
import { PLAN_CREDITS } from './plans/permissions.js';
import { getPlanPermissions, resolveApiFeature, getUpgradeMessage } from './plans/permissions.js';
import { createHash } from 'crypto';
async function getSubscriptionRowByEmail(email) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.* FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE lower(u.email) = lower($1)`,
    [email]
  );
  return r.rows[0] || null;
}

const UNLIMITED_EMAIL = 'h.asgarizade@gmail.com';

export const PROCESSING_OPERATIONS = {
  transcript: { usageType: 'transcription', feature: 'transcription' },
  translation: { usageType: 'srt', feature: 'translate', translationOnly: true },
  subtitle: { usageType: 'srt', feature: 'subtitles' },
  mp4_export: { usageType: 'mp4_export', feature: 'mp4Export' }
};

const CREDIT_HISTORY_TYPES = new Set(['transcription', 'srt', 'mp4_export']);

function dayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSourceUrlForQuota(raw) {
  const v = raw != null ? String(raw).trim() : '';
  if (!v) return '';
  try {
    const u = new URL(v);
    u.hash = '';
    const params = Array.from(u.searchParams.entries())
      .filter(([k]) => !/^utm_/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    u.search = params.length
      ? `?${params.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&')}`
      : '';
    return u.toString();
  } catch {
    return v.replace(/\s+/g, '');
  }
}

function sourceUrlHash(raw) {
  const normalized = normalizeSourceUrlForQuota(raw);
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Resolve subscription billing period (single source for credit resets).
 */
export function resolveBillingCycle(subRow) {
  const now = new Date();

  if (subRow?.current_period_start && subRow?.current_period_end) {
    return {
      cycleStart: new Date(subRow.current_period_start).toISOString(),
      cycleEnd: new Date(subRow.current_period_end).toISOString(),
      cycleKey: new Date(subRow.current_period_start).toISOString()
    };
  }

  if (subRow?.current_period_end) {
    const cycleEnd = new Date(subRow.current_period_end);
    const cycleStart = new Date(cycleEnd);
    cycleStart.setMonth(cycleStart.getMonth() - 1);
    return {
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
      cycleKey: cycleStart.toISOString()
    };
  }

  const anchor = subRow?.created_at ? new Date(subRow.created_at) : now;
  let cycleStart = new Date(anchor);
  let cycleEnd = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);

  while (cycleEnd <= now) {
    cycleStart = new Date(cycleEnd);
    cycleEnd = new Date(cycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);
  }

  return {
    cycleStart: cycleStart.toISOString(),
    cycleEnd: cycleEnd.toISOString(),
    cycleKey: cycleStart.toISOString()
  };
}

function creditLimitForPlan(planKey, plan) {
  return plan?.monthlyGenerationLimit ?? plan?.monthlyLimit ?? PLAN_CREDITS[planKey] ?? 3;
}

/**
 * Lock usage row, reset credits when billing cycle changes (not calendar month).
 */
export async function lockUsageForBillingCycle(client, userId, subRow) {
  const cycle = resolveBillingCycle(subRow);
  const cycleStartDate = new Date(cycle.cycleStart);
  const d = dayUtc();

  let r = await client.query('SELECT * FROM usage WHERE user_id = $1 FOR UPDATE', [userId]);
  if (r.rows.length === 0) {
    await client.query(
      `INSERT INTO usage (user_id, usage_month_key, daily_period_date, billing_cycle_start)
       VALUES ($1, $2, $3::date, $4)`,
      [userId, cycle.cycleKey.slice(0, 7), d, cycleStartDate]
    );
    r = await client.query('SELECT * FROM usage WHERE user_id = $1 FOR UPDATE', [userId]);
  }

  const row = r.rows[0];
  let creditsUsed = Number(row.minutes_used) || 0;
  let dailyMinutes = Number(row.daily_minutes_used) || 0;
  let audio = Number(row.audio_downloads) || 0;
  let video = Number(row.video_downloads) || 0;
  let billingCycleStart = row.billing_cycle_start
    ? new Date(row.billing_cycle_start).toISOString()
    : null;
  let dailyDate =
    row.daily_period_date instanceof Date
      ? row.daily_period_date.toISOString().slice(0, 10)
      : String(row.daily_period_date).slice(0, 10);

  let dirty = false;

  if (billingCycleStart !== cycle.cycleKey) {
    creditsUsed = 0;
    audio = 0;
    video = 0;
    billingCycleStart = cycle.cycleKey;
    dirty = true;
  }

  if (dailyDate !== d) {
    dailyMinutes = 0;
    dailyDate = d;
    dirty = true;
  }

  if (dirty) {
    await client.query(
      `UPDATE usage SET
        minutes_used = $2,
        daily_minutes_used = $3,
        audio_downloads = $4,
        video_downloads = $5,
        billing_cycle_start = $6::timestamptz,
        usage_month_key = $7,
        daily_period_date = $8::date,
        last_reset_at = NOW()
      WHERE user_id = $1`,
      [
        userId,
        creditsUsed,
        dailyMinutes,
        audio,
        video,
        cycleStartDate,
        cycle.cycleKey.slice(0, 7),
        dailyDate
      ]
    );
  }

  return {
    creditsUsed,
    dailyMinutes,
    audioDownloads: audio,
    videoDownloads: video,
    billingCycleStart: cycle.cycleKey,
    dailyDate,
    cycle
  };
}

/**
 * Normalize usage for an email (read path — applies billing-cycle reset).
 */
export async function normalizeUsageForEmail(email) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRow = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    const userId = uRow.rows[0].id;
    const sub = await getSubscriptionRowByEmail(email);
    const u = await lockUsageForBillingCycle(client, userId, sub);
    await client.query('COMMIT');
    return u;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Single source of truth for dashboard credit counters.
 */
export async function getCreditsSnapshot(email) {
  if (email === UNLIMITED_EMAIL) {
    const sub = await getSubscriptionRowByEmail(email);
    const cycle = resolveBillingCycle(sub || { created_at: new Date() });
    return {
      used: 0,
      remaining: 999999,
      limit: 999999,
      cycleStart: cycle.cycleStart,
      cycleEnd: cycle.cycleEnd
    };
  }

  const sub = await getSubscriptionRowByEmail(email);
  const planKey = resolvePlanKey(sub?.plan || 'free');
  const plan = getPlanDef(planKey);
  const limit = creditLimitForPlan(planKey, plan);
  const u = await normalizeUsageForEmail(email);
  const used = Math.round(u.creditsUsed);
  const remaining = Math.max(0, limit - used);

  return {
    used,
    remaining,
    limit,
    cycleStart: u.cycle.cycleStart,
    cycleEnd: u.cycle.cycleEnd
  };
}

/**
 * Lifetime metrics — never mixed with monthly credits.
 */
export async function getLifetimeMetrics(email) {
  const pool = getPool();
  const userRes = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (!userRes.rows.length) {
    return { outputs: 0, mp4Exports: 0, processingJobs: 0 };
  }
  const userId = userRes.rows[0].id;

  const [outputsRes, exportsRes, jobsRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM saved_outputs WHERE user_id = $1', [userId]),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM project_exports WHERE user_id = $1 AND status = 'completed'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM usage_history
       WHERE user_id = $1
         AND type = ANY($2::text[])
         AND minutes > 0`,
      [userId, Array.from(CREDIT_HISTORY_TYPES)]
    )
  ]);

  return {
    outputs: Number(outputsRes.rows[0]?.c) || 0,
    mp4Exports: Number(exportsRes.rows[0]?.c) || 0,
    processingJobs: Number(jobsRes.rows[0]?.c) || 0
  };
}

/**
 * Consume one processing credit for a successful operation.
 * @param {string} email
 * @param {'transcript'|'translation'|'subtitle'|'mp4_export'} operation
 * @param {object} metadata
 */
export async function consumeProcessingCredit(email, operation, metadata = {}) {
  const opDef = PROCESSING_OPERATIONS[operation];
  if (!opDef) return { ok: false, reason: 'Invalid processing operation.' };

  if (email === UNLIMITED_EMAIL) {
    return applyUnlimitedProcessingCredit(email, opDef, metadata);
  }
  if (!email) return { ok: false, reason: 'User email required.' };

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const uRow = await client.query('SELECT id FROM users WHERE lower(email) = lower($1) FOR UPDATE', [email]);
    if (!uRow.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'User not found.' };
    }
    const userId = uRow.rows[0].id;

    const subR = await client.query('SELECT * FROM subscriptions WHERE user_id = $1 FOR UPDATE', [userId]);
    const sub = subR.rows[0];
    const planKey = resolvePlanKey(sub?.plan || 'free');
    const plan = getPlanDef(planKey);
    if (!plan) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'Invalid plan state.' };
    }

    const featureDef = resolveApiFeature(opDef.feature);
    const perms = getPlanPermissions(planKey);
    if (featureDef?.permission && !perms[featureDef.permission]) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: getUpgradeMessage(featureDef.permission),
        code: 'FEATURE_NOT_AVAILABLE'
      };
    }

    if (planKey !== 'free') {
      if (sub.status === 'past_due') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'Subscription is past due. Update your payment method.' };
      }
      if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'Your subscription has expired. Please renew to continue.' };
      }
    }

    const u = await lockUsageForBillingCycle(client, userId, sub);
    const genLimit = creditLimitForPlan(planKey, plan);
    const billUnits = 1;

    const normalizedSourceUrl = normalizeSourceUrlForQuota(metadata?.sourceUrl || metadata?.url || '');
    const normalizedSourceHash = sourceUrlHash(normalizedSourceUrl);

    if (operation === 'mp4_export' && metadata?.jobId) {
      const reusedJob = await client.query(
        `SELECT id FROM usage_history
         WHERE user_id = $1 AND type = 'mp4_export' AND metadata->>'jobId' = $2
         LIMIT 1`,
        [userId, String(metadata.jobId)]
      );
      if (reusedJob.rows.length > 0) {
        await client.query('COMMIT');
        return { ok: true, reused: true };
      }
    }

    if (operation === 'transcript' && normalizedSourceHash) {
      const reused = await client.query(
        `SELECT id FROM usage_history
         WHERE user_id = $1
           AND type = 'transcription'
           AND metadata->>'sourceUrlHash' = $2
           AND created_at >= $3::timestamptz
         ORDER BY created_at DESC LIMIT 1`,
        [userId, normalizedSourceHash, u.cycle.cycleStart]
      );
      if (reused.rows.length > 0) {
        await client.query('COMMIT');
        return { ok: true, reused: true };
      }
    }

    if (planKey === 'free' && Number(plan.dailyLimit) < 50000) {
      if (u.dailyMinutes + billUnits > plan.dailyLimit) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'Daily limit reached. Try again tomorrow or upgrade.' };
      }
    }

    if (u.creditsUsed + billUnits > genLimit) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: `You've used all ${genLimit} video processing credits this cycle. Upgrade for more capacity.`
      };
    }

    const newCredits = u.creditsUsed + billUnits;
    const newDaily = u.dailyMinutes + billUnits;
    await client.query(
      `UPDATE usage SET minutes_used = $2, daily_minutes_used = $3, last_reset_at = NOW() WHERE user_id = $1`,
      [userId, newCredits, newDaily]
    );

    const usageMeta = {
      ...(metadata || {}),
      operation,
      creditConsumed: true,
      sourceUrlNorm: normalizedSourceUrl || null,
      sourceUrlHash: normalizedSourceHash || null,
      translationOnly: opDef.translationOnly === true,
      generations: billUnits
    };

    await client.query(
      `INSERT INTO usage_history (user_id, type, minutes, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, opDef.usageType, billUnits, JSON.stringify(usageMeta)]
    );

    await client.query('COMMIT');
    if (!metadata?.skipActivityFeed) {
      const { recordProcessingActivityFromCredit } = await import('./activity-feed-repository.js');
      void recordProcessingActivityFromCredit(email, operation, metadata);
    }
    return { ok: true, consumed: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function applyUnlimitedProcessingCredit(email, opDef, metadata) {
  const pool = getPool();
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = userRes.rows[0]?.id;
  if (!userId) return { ok: true };
  await pool.query(
    `INSERT INTO usage_history (user_id, type, minutes, metadata)
     VALUES ($1, $2, 1, $3::jsonb)`,
    [
      userId,
      opDef.usageType,
      JSON.stringify({ ...(metadata || {}), unlimited: true, creditConsumed: true })
    ]
  );
  const opKey = Object.entries(PROCESSING_OPERATIONS).find(([, v]) => v.usageType === opDef.usageType)?.[0];
  if (opKey) {
    const { recordProcessingActivityFromCredit } = await import('./activity-feed-repository.js');
    void recordProcessingActivityFromCredit(email, opKey, metadata);
  }
  return { ok: true, consumed: true };
}
