import { getPool, isBillingDbConfigured } from './db/pool.js';
import { PLANS, getPlanDef, resolvePlanKey } from './plans-config.js';
import { createHash } from 'crypto';

const UNLIMITED_EMAIL = 'h.asgarizade@gmail.com';

export { isBillingDbConfigured };

function monthKeyUtc() {
  return new Date().toISOString().slice(0, 7);
}

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
 * Create user + default subscription + usage if missing.
 */
export async function ensureUserByEmail(email) {
  if (!email) throw new Error('ensureUserByEmail: email required');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let r = await client.query(
      `SELECT id, COALESCE(account_status, 'active') AS account_status
       FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
      [email]
    );
    let userId;
    if (r.rows.length > 0) {
      const st = String(r.rows[0].account_status || 'active').toLowerCase();
      if (st === 'deactivated' || st === 'banned') {
        const err = new Error('ACCOUNT_DEACTIVATED');
        err.code = 'ACCOUNT_DEACTIVATED';
        throw err;
      }
    }
    if (r.rows.length === 0) {
      r = await client.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
      userId = r.rows[0].id;
      await client.query(
        `INSERT INTO subscriptions (user_id, plan, status, billing_period, updated_at)
         VALUES ($1, 'free', 'active', 'monthly', NOW())`,
        [userId]
      );
      await client.query(
        `INSERT INTO usage (user_id, usage_month_key, daily_period_date)
         VALUES ($1, to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM'), (NOW() AT TIME ZONE 'UTC')::date)`,
        [userId]
      );
    } else {
      userId = r.rows[0].id;
      await client.query(
        `INSERT INTO subscriptions (user_id, plan, status, billing_period, updated_at)
         VALUES ($1, 'free', 'active', 'monthly', NOW())
         ON CONFLICT ON CONSTRAINT subscriptions_one_per_user DO NOTHING`,
        [userId]
      );
      await client.query(
        `INSERT INTO usage (user_id, usage_month_key, daily_period_date)
         VALUES ($1, to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM'), (NOW() AT TIME ZONE 'UTC')::date)
         ON CONFLICT ON CONSTRAINT usage_one_per_user DO NOTHING`,
        [userId]
      );
    }
    await client.query('COMMIT');
    return userId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Load usage row and apply calendar month / UTC day resets. Returns normalized snapshot.
 */
export async function getNormalizedUsage(userId) {
  const pool = getPool();
  const mk = monthKeyUtc();
  const d = dayUtc();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM usage WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        monthlyMinutes: 0,
        dailyMinutes: 0,
        audioDownloads: 0,
        videoDownloads: 0,
        monthKey: mk,
        dailyDate: d
      };
    }
    const row = r.rows[0];
    let minutesUsed = Number(row.minutes_used) || 0;
    let dailyMinutes = Number(row.daily_minutes_used) || 0;
    let audio = Number(row.audio_downloads) || 0;
    let video = Number(row.video_downloads) || 0;
    let monthKey = row.usage_month_key;
    let dailyDate = row.daily_period_date instanceof Date
      ? row.daily_period_date.toISOString().slice(0, 10)
      : String(row.daily_period_date).slice(0, 10);

    let dirty = false;
    if (monthKey !== mk) {
      minutesUsed = 0;
      audio = 0;
      video = 0;
      monthKey = mk;
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
          usage_month_key = $6,
          daily_period_date = $7::date,
          last_reset_at = NOW()
        WHERE user_id = $1`,
        [userId, minutesUsed, dailyMinutes, audio, video, monthKey, dailyDate]
      );
    }
    await client.query('COMMIT');

    const [y, m] = monthKey.split('-').map(Number);
    return {
      monthlyMinutes: minutesUsed,
      dailyMinutes,
      audioDownloads: audio,
      videoDownloads: video,
      monthKey,
      dailyDate,
      monthIndex: m - 1,
      year: y
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getSubscriptionRowByEmail(email) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.* FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE u.email = $1`,
    [email]
  );
  return r.rows[0] || null;
}

export async function getLegacyUsageShape(email) {
  const pool = getPool();
  const r = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (r.rows.length === 0) {
    const now = new Date();
    return {
      daily: { date: dayUtc(), minutes: 0 },
      monthly: { month: now.getMonth(), year: now.getFullYear(), minutes: 0 },
      downloads: {
        audio: { month: now.getMonth(), year: now.getFullYear(), count: 0 },
        video: { month: now.getMonth(), year: now.getFullYear(), count: 0 }
      }
    };
  }
  const u = await getNormalizedUsage(r.rows[0].id);
  const [y, m] = u.monthKey.split('-').map(Number);
  return {
    daily: { date: u.dailyDate, minutes: u.dailyMinutes },
    monthly: { month: m - 1, year: y, minutes: u.monthlyMinutes },
    downloads: {
      audio: { month: m - 1, year: y, count: u.audioDownloads },
      video: { month: m - 1, year: y, count: u.videoDownloads }
    }
  };
}

/** Force-set Stripe IDs (checkout completed). */
export async function applyStripeSubscriptionDbFromCheckout(email, planKey, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd) {
  const userId = await ensureUserByEmail(email);
  const pool = getPool();
  await pool.query(
    `UPDATE subscriptions SET
      plan = $2,
      status = 'active',
      billing_period = 'monthly',
      stripe_customer_id = $3,
      stripe_subscription_id = $4,
      current_period_end = $5,
      updated_at = NOW()
    WHERE user_id = $1`,
    [userId, planKey, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd]
  );
}

export async function syncStripeSubscriptionFromStripeObject(email, planKey, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, status = 'active') {
  const userId = await ensureUserByEmail(email);
  const pool = getPool();
  await pool.query(
    `UPDATE subscriptions SET
      plan = $2,
      status = $3,
      stripe_customer_id = COALESCE($4, stripe_customer_id),
      stripe_subscription_id = COALESCE($5, stripe_subscription_id),
      current_period_end = $6,
      updated_at = NOW()
    WHERE user_id = $1`,
    [userId, planKey, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd]
  );
}

export async function downgradeStripeSubscriptionDb(email) {
  const pool = getPool();
  await pool.query(
    `UPDATE subscriptions s SET
      plan = 'free',
      status = 'active',
      stripe_subscription_id = NULL,
      current_period_end = NULL,
      updated_at = NOW()
    FROM users u
    WHERE s.user_id = u.id AND u.email = $1`,
    [email]
  );
}

export async function upgradePlanLegacyDb(email, plan, billingPeriod) {
  const userId = await ensureUserByEmail(email);
  const pool = getPool();
  const end = new Date();
  if (billingPeriod === 'quarterly') end.setMonth(end.getMonth() + 3);
  else if (billingPeriod === 'semiannual') end.setMonth(end.getMonth() + 6);
  else if (billingPeriod === 'annual') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);

  await pool.query(
    `UPDATE subscriptions SET
      plan = $2,
      billing_period = $3,
      current_period_end = $4,
      status = 'active',
      updated_at = NOW()
    WHERE user_id = $1`,
    [userId, plan, billingPeriod, end]
  );
}

const MINUTE_USAGE_TYPES = new Set(['transcription', 'summarization', 'srt']);

async function insertUsageHistoryOnly(email, type, minutes, metadata = {}) {
  if (!email) return;
  await ensureUserByEmail(email);
  const pool = getPool();
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!userRes.rows.length) return;
  await pool.query(
    `INSERT INTO usage_history (user_id, type, minutes, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userRes.rows[0].id, type, Number(minutes) || 0, JSON.stringify(metadata || {})]
  );
}
const MAX_MINUTE_DELTA = 1440;

async function applyUnlimitedUsageAtomic(email, deltaMinutes, usageType, metadata = {}) {
  const delta = Number(deltaMinutes);
  if (!Number.isFinite(delta) || delta === 0) return { ok: true };
  const clamped = Math.min(Math.abs(delta), MAX_MINUTE_DELTA);
  const direction = delta > 0 ? 1 : -1;
  const applied = clamped * direction;

  await ensureUserByEmail(email);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRow = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    if (!uRow.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'User not found.' };
    }
    const userId = uRow.rows[0].id;
    const usage = await lockUsageAndNormalizeClient(client, userId);
    const nextMonthly = Math.max(0, usage.monthlyMinutes + applied);
    const nextDaily = Math.max(0, usage.dailyMinutes + applied);
    await client.query(
      `UPDATE usage SET minutes_used = $2, daily_minutes_used = $3, last_reset_at = NOW() WHERE user_id = $1`,
      [userId, nextMonthly, nextDaily]
    );
    await client.query(
      `INSERT INTO usage_history (user_id, type, minutes, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, usageType, Math.abs(applied), JSON.stringify(metadata || {})]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function incrementUnlimitedDownloadAtomic(email, kind, metadata = {}) {
  await ensureUserByEmail(email);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRow = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    if (!uRow.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'User not found.' };
    }
    const userId = uRow.rows[0].id;
    const usage = await lockUsageAndNormalizeClient(client, userId);
    const newAudio = kind === 'audio' ? usage.audioDownloads + 1 : usage.audioDownloads;
    const newVideo = kind === 'video' ? usage.videoDownloads + 1 : usage.videoDownloads;
    await client.query(
      `UPDATE usage SET audio_downloads = $2, video_downloads = $3, last_reset_at = NOW() WHERE user_id = $1`,
      [userId, newAudio, newVideo]
    );
    await client.query(
      `INSERT INTO usage_history (user_id, type, minutes, metadata)
       VALUES ($1, 'download', 0, $2::jsonb)`,
      [userId, JSON.stringify({ ...metadata, kind })]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Lock usage row, apply month/day resets, return current counters (inside an open transaction).
 */
async function lockUsageAndNormalizeClient(client, userId) {
  const mk = monthKeyUtc();
  const d = dayUtc();
  let r = await client.query('SELECT * FROM usage WHERE user_id = $1 FOR UPDATE', [userId]);
  if (r.rows.length === 0) {
    await client.query(
      `INSERT INTO usage (user_id, usage_month_key, daily_period_date)
       VALUES ($1, $2, $3::date)`,
      [userId, mk, d]
    );
    r = await client.query('SELECT * FROM usage WHERE user_id = $1 FOR UPDATE', [userId]);
  }
  const row = r.rows[0];
  let minutesUsed = Number(row.minutes_used) || 0;
  let dailyMinutes = Number(row.daily_minutes_used) || 0;
  let audio = Number(row.audio_downloads) || 0;
  let video = Number(row.video_downloads) || 0;
  let monthKey = row.usage_month_key;
  let dailyDate =
    row.daily_period_date instanceof Date
      ? row.daily_period_date.toISOString().slice(0, 10)
      : String(row.daily_period_date).slice(0, 10);

  let dirty = false;
  if (monthKey !== mk) {
    minutesUsed = 0;
    audio = 0;
    video = 0;
    monthKey = mk;
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
        usage_month_key = $6,
        daily_period_date = $7::date,
        last_reset_at = NOW()
      WHERE user_id = $1`,
      [userId, minutesUsed, dailyMinutes, audio, video, monthKey, dailyDate]
    );
  }
  return {
    monthlyMinutes: minutesUsed,
    dailyMinutes,
    audioDownloads: audio,
    videoDownloads: video,
    monthKey,
    dailyDate
  };
}

function planFeatureKeyForUsageType(usageType) {
  if (usageType === 'transcription') return 'transcription';
  if (usageType === 'summarization') return 'summarization';
  if (usageType === 'srt') return 'srt';
  return null;
}

/**
 * Atomically validate limits and apply minute delta + history row (single transaction).
 * usageType: transcription | summarization | srt
 * deltaMinutes may be negative for internal adjustments only (refunds).
 */
export async function applyUsageMinutesAtomic(email, deltaMinutes, usageType, metadata = {}) {
  if (email === UNLIMITED_EMAIL) {
    return applyUnlimitedUsageAtomic(email, deltaMinutes, usageType, metadata);
  }
  if (!email) return { ok: false, reason: 'User email required.' };
  if (!MINUTE_USAGE_TYPES.has(usageType)) {
    return { ok: false, reason: 'Invalid usage type.' };
  }
  const delta = Number(deltaMinutes);
  if (!Number.isFinite(delta) || delta === 0) return { ok: true };

  await ensureUserByEmail(email);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const uRow = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    if (uRow.rows.length === 0) {
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

    const featureKey = planFeatureKeyForUsageType(usageType);
    if (delta > 0 && !plan.features[featureKey]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'This feature is not available on your current plan.' };
    }

    if (delta > 0 && planKey !== 'free') {
      if (sub.status === 'past_due') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'Subscription is past due. Update your payment method.' };
      }
      if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'Your subscription has expired. Please renew to continue.' };
      }
    }

    const u = await lockUsageAndNormalizeClient(client, userId);

    if (delta > 0) {
      if (usageType !== 'transcription') {
        await client.query('COMMIT');
        return { ok: true };
      }

      const normalizedSourceUrl = normalizeSourceUrlForQuota(metadata?.sourceUrl || metadata?.url || '');
      const normalizedSourceHash = sourceUrlHash(normalizedSourceUrl);
      if (normalizedSourceHash) {
        const reused = await client.query(
          `SELECT id
           FROM usage_history
           WHERE user_id = $1
             AND type = 'transcription'
             AND metadata->>'sourceUrlHash' = $2
             AND created_at >= date_trunc('month', NOW())
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId, normalizedSourceHash]
        );
        if (reused.rows.length > 0) {
          console.log('[quota-session]', {
            sessionId: metadata?.processingSessionId || null,
            sourceUrl: normalizedSourceUrl || null,
            quotaIncremented: false,
            reusedExistingPipeline: true,
            translationOnly: false,
            cacheHit: true
          });
          await client.query('COMMIT');
          return { ok: true, reused: true };
        }
      }

      const genLimit =
        plan.monthlyGenerationLimit != null ? plan.monthlyGenerationLimit : plan.monthlyLimit;
      const billUnits = 1;

      if (planKey === 'free' && Number(plan.dailyLimit) < 50000) {
        if (u.dailyMinutes + billUnits > plan.dailyLimit) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            reason: 'Daily limit reached. Try again tomorrow or upgrade.'
          };
        }
      }
      if (u.monthlyMinutes + billUnits > genLimit) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          reason: `You've used all ${genLimit} included generations this month. Upgrade for more capacity.`
        };
      }

      const newMonthly = u.monthlyMinutes + billUnits;
      const newDaily = u.dailyMinutes + billUnits;
      await client.query(
        `UPDATE usage SET minutes_used = $2, daily_minutes_used = $3, last_reset_at = NOW() WHERE user_id = $1`,
        [userId, newMonthly, newDaily]
      );
      const usageMeta = {
        ...(metadata || {}),
        sourceUrlNorm: normalizedSourceUrl || null,
        sourceUrlHash: normalizedSourceHash || null,
        generations: billUnits
      };
      await client.query(
        `INSERT INTO usage_history (user_id, type, minutes, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [userId, usageType, billUnits, JSON.stringify(usageMeta)]
      );
      console.log('[quota-session]', {
        sessionId: metadata?.processingSessionId || null,
        sourceUrl: normalizedSourceUrl || null,
        quotaIncremented: true,
        reusedExistingPipeline: false,
        translationOnly: false,
        cacheHit: false
      });
    } else {
      const refund = Math.min(Math.abs(delta), MAX_MINUTE_DELTA);
      const newMonthly = Math.max(0, u.monthlyMinutes - refund);
      const newDaily = Math.max(0, u.dailyMinutes - refund);
      await client.query(
        `UPDATE usage SET minutes_used = $2, daily_minutes_used = $3, last_reset_at = NOW() WHERE user_id = $1`,
        [userId, newMonthly, newDaily]
      );
      await client.query(
        `INSERT INTO usage_history (user_id, type, minutes, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [userId, usageType, -refund, JSON.stringify({ ...metadata, adjustment: 'refund' })]
      );
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Atomically check download entitlement and increment slot + history (type "download", metadata.kind).
 */
export async function consumeDownloadSlotAtomic(email, kind, metadata = {}) {
  if (email === UNLIMITED_EMAIL) {
    if (kind !== 'audio' && kind !== 'video') return { ok: false, reason: 'Invalid download kind.' };
    return incrementUnlimitedDownloadAtomic(email, kind, metadata);
  }
  if (kind !== 'audio' && kind !== 'video') {
    return { ok: false, reason: 'Invalid download kind.' };
  }

  await ensureUserByEmail(email);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const uRow = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    const userId = uRow.rows[0].id;

    const subR = await client.query('SELECT * FROM subscriptions WHERE user_id = $1 FOR UPDATE', [userId]);
    const sub = subR.rows[0];
    const planKey = resolvePlanKey(sub?.plan || 'free');
    const plan = getPlanDef(planKey);
    if (!plan) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'Invalid plan state.' };
    }

    const feature = kind === 'audio' ? 'downloadAudio' : 'downloadVideo';
    if (!plan.features[feature]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'This feature is not available on your current plan.' };
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

    const u = await lockUsageAndNormalizeClient(client, userId);
    const limit = kind === 'audio' ? plan.downloadAudioLimit : plan.downloadVideoLimit;
    const count = kind === 'audio' ? u.audioDownloads : u.videoDownloads;
    if (limit != null && count >= limit) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: `Your monthly ${kind === 'audio' ? 'audio' : 'video'} download limit (${limit}) is reached. Upgrade for more.`
      };
    }

    const newAudio = kind === 'audio' ? u.audioDownloads + 1 : u.audioDownloads;
    const newVideo = kind === 'video' ? u.videoDownloads + 1 : u.videoDownloads;
    await client.query(
      `UPDATE usage SET audio_downloads = $2, video_downloads = $3, last_reset_at = NOW() WHERE user_id = $1`,
      [userId, newAudio, newVideo]
    );

    const meta = { ...metadata, kind };
    await client.query(
      `INSERT INTO usage_history (user_id, type, minutes, metadata)
       VALUES ($1, 'download', 0, $2::jsonb)`,
      [userId, JSON.stringify(meta)]
    );

    await client.query('COMMIT');
    return { ok: true, consumed: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Refund one download slot after a failed extraction (social / yt-dlp).
 * Safe to call if slot was never consumed.
 */
export async function refundDownloadSlotAtomic(email, kind, metadata = {}) {
  if (email === UNLIMITED_EMAIL) return { ok: true };
  if (kind !== 'audio' && kind !== 'video') return { ok: false, reason: 'Invalid download kind.' };

  await ensureUserByEmail(email);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRow = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    const userId = uRow.rows[0]?.id;
    if (!userId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'User not found.' };
    }
    const u = await lockUsageAndNormalizeClient(client, userId);
    const newAudio = kind === 'audio' ? Math.max(0, u.audioDownloads - 1) : u.audioDownloads;
    const newVideo = kind === 'video' ? Math.max(0, u.videoDownloads - 1) : u.videoDownloads;
    await client.query(
      `UPDATE usage SET audio_downloads = $2, video_downloads = $3, last_reset_at = NOW() WHERE user_id = $1`,
      [userId, newAudio, newVideo]
    );
    await client.query(
      `INSERT INTO usage_history (user_id, type, minutes, metadata)
       VALUES ($1, 'download', 0, $2::jsonb)`,
      [userId, JSON.stringify({ ...metadata, kind, adjustment: 'refund' })]
    );
    await client.query('COMMIT');
    console.log('[quota-session]', { email, kind, quotaIncremented: false, refunded: true });
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** @deprecated Use applyUsageMinutesAtomic — kept for any legacy callers */
export async function recordUsageDb(email, minutes, type, metadata = {}) {
  if (!minutes || minutes <= 0) return;
  const r = await applyUsageMinutesAtomic(email, minutes, type, metadata);
  if (!r.ok) throw new Error(r.reason || 'Usage record denied');
}

/** @deprecated Use consumeDownloadSlotAtomic */
export async function recordDownloadDb(email, type, metadata = {}) {
  const r = await consumeDownloadSlotAtomic(email, type === 'audio' ? 'audio' : 'video', metadata);
  if (!r.ok) throw new Error(r.reason || 'Download record denied');
}

export async function resetAudioDownloadsDb(email) {
  const pool = getPool();
  await pool.query(
    `UPDATE usage SET audio_downloads = 0, last_reset_at = NOW()
     WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email]
  );
}

export async function getUsageHistoryDb(email, limit = 100) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT h.* FROM usage_history h
     JOIN users u ON u.id = h.user_id
     WHERE u.email = $1
     ORDER BY h.created_at DESC
     LIMIT $2`,
    [email, limit]
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    minutes: Number(row.minutes),
    date: row.created_at.toISOString(),
    metadata: row.metadata || {}
  }));
}

export async function saveOutputDb(email, payload = {}) {
  const {
    type,
    title = null,
    platform = null,
    sourceUrl = null,
    language = null,
    content,
    metadata = {},
    projectId: explicitProjectId = null
  } = payload;

  if (!email || !type || !content) return null;
  await ensureUserByEmail(email);
  const pool = getPool();
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!userRes.rows.length) return null;
  const userId = userRes.rows[0].id;

  let projectId = explicitProjectId || metadata.projectId || null;
  try {
    const { upsertProjectFromSaveOutput, linkSavedOutputToProject } = await import(
      './projects-repository.js'
    );
    projectId = await upsertProjectFromSaveOutput(email, {
      type,
      title,
      platform,
      sourceUrl,
      language,
      content,
      metadata,
      projectId
    });
  } catch (err) {
    console.warn('[saveOutputDb] project upsert skipped:', err?.message || err);
  }

  const dedupeWindowMinutes = 120;
  const existing = await pool.query(
    `SELECT id FROM saved_outputs
     WHERE user_id = $1
       AND type = $2
       AND COALESCE(source_url, '') = COALESCE($3, '')
       AND COALESCE(title, '') = COALESCE($4, '')
       AND created_at > NOW() - ($5 || ' minutes')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, type, sourceUrl, title, dedupeWindowMinutes]
  );

  let outputId;
  if (existing.rows.length > 0) {
    outputId = existing.rows[0].id;
    await pool.query(
      `UPDATE saved_outputs
       SET platform = $2,
           language = $3,
           content = $4,
           metadata = $5::jsonb,
           project_id = COALESCE($6, project_id),
           updated_at = NOW()
       WHERE id = $1`,
      [outputId, platform, language, content, JSON.stringify(metadata || {}), projectId]
    );
  } else {
    const inserted = await pool.query(
      `INSERT INTO saved_outputs
        (user_id, project_id, type, title, platform, source_url, language, content, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        userId,
        projectId,
        type,
        title,
        platform,
        sourceUrl,
        language,
        content,
        JSON.stringify(metadata || {})
      ]
    );
    outputId = inserted.rows[0].id;
  }

  if (projectId && outputId) {
    try {
      const { linkSavedOutputToProject } = await import('./projects-repository.js');
      await linkSavedOutputToProject(String(outputId), projectId);
    } catch {
      /* noop */
    }
  }

  return String(outputId);
}

export async function getSavedOutputsDb(email, limit = 100) {
  if (!email) return [];
  await ensureUserByEmail(email);
  const pool = getPool();
  const rows = await pool.query(
    `SELECT s.* FROM saved_outputs s
     JOIN users u ON u.id = s.user_id
     WHERE u.email = $1
     ORDER BY s.is_favorite DESC, s.created_at DESC
     LIMIT $2`,
    [email, limit]
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    title: row.title,
    platform: row.platform,
    sourceUrl: row.source_url,
    language: row.language,
    content: row.content,
    isFavorite: Boolean(row.is_favorite),
    metadata: row.metadata || {},
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at?.toISOString ? row.updated_at.toISOString() : row.updated_at
  }));
}

export async function renameSavedOutputDb(email, outputId, title) {
  if (!email || !outputId) return false;
  await ensureUserByEmail(email);
  const pool = getPool();
  const trimmedTitle = String(title ?? '').trim().slice(0, 160);
  const updated = await pool.query(
    `UPDATE saved_outputs s
     SET title = $3,
         updated_at = NOW()
     FROM users u
     WHERE s.user_id = u.id
       AND u.email = $1
       AND s.id = $2::bigint
     RETURNING s.id`,
    [email, outputId, trimmedTitle || null]
  );
  return updated.rows.length > 0;
}

export async function toggleSavedOutputFavoriteDb(email, outputId, favorite) {
  if (!email || !outputId) return false;
  await ensureUserByEmail(email);
  const pool = getPool();
  const updated = await pool.query(
    `UPDATE saved_outputs s
     SET is_favorite = $3,
         updated_at = NOW()
     FROM users u
     WHERE s.user_id = u.id
       AND u.email = $1
       AND s.id = $2::bigint
     RETURNING s.id`,
    [email, outputId, Boolean(favorite)]
  );
  return updated.rows.length > 0;
}

/**
 * Webhook idempotency: returns true if this event should be processed (new row inserted).
 */
export async function claimStripeWebhookEvent(client, eventId) {
  const r = await client.query(
    `INSERT INTO stripe_webhook_events (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [eventId]
  );
  return r.rowCount === 1;
}

/** Idempotent claim (auto-commit). Returns true if this worker should process the event. */
export async function tryClaimStripeEventStandalone(eventId) {
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO stripe_webhook_events (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [eventId]
  );
  return r.rowCount === 1;
}

export async function releaseStripeWebhookClaim(eventId) {
  const pool = getPool();
  await pool.query('DELETE FROM stripe_webhook_events WHERE id = $1', [eventId]);
}

export async function getAdminOverviewDb() {
  const pool = getPool();
  const [usersRes, usageRes, outputsRes, downloadsRes, activeUsersRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users'),
    pool.query('SELECT COALESCE(SUM(minutes_used), 0)::float AS total_minutes FROM usage'),
    pool.query('SELECT COUNT(*)::int AS count FROM saved_outputs'),
    pool.query(
      `SELECT
         COALESCE(SUM(audio_downloads), 0)::int AS audio_total,
         COALESCE(SUM(video_downloads), 0)::int AS video_total
       FROM usage`
    ),
    pool.query(
      `SELECT COUNT(DISTINCT user_id)::int AS count
       FROM usage_history
       WHERE created_at >= date_trunc('month', NOW())`
    )
  ]);
  const totalProcessedMinutes = Number(usageRes.rows[0]?.total_minutes || 0);
  return {
    totalUsers: Number(usersRes.rows[0]?.count || 0),
    activeUsersThisMonth: Number(activeUsersRes.rows[0]?.count || 0),
    totalProcessedMinutes,
    totalVideosEstimate: Math.ceil(totalProcessedMinutes / 7),
    totalSavedOutputs: Number(outputsRes.rows[0]?.count || 0),
    totalAudioDownloads: Number(downloadsRes.rows[0]?.audio_total || 0),
    totalVideoDownloads: Number(downloadsRes.rows[0]?.video_total || 0)
  };
}

/** Admin Customers: editable plans (must match UI dropdown). */
const ADMIN_CUSTOMER_PLAN_KEYS = new Set(['free', 'starter', 'pro', 'business']);

function planLabelForAdmin(planKey) {
  const k = resolvePlanKey(planKey);
  if (!k) return 'Free';
  const def = getPlanDef(k);
  if (def?.name) return def.name;
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function subscriptionPriceLabel(planKey) {
  const k = resolvePlanKey(planKey);
  if (!k || !getPlanDef(k)) return '—';
  const eur = getPlanDef(k).priceEur?.monthly;
  if (eur == null || Number(eur) === 0) return '€0';
  const n = Number(eur);
  return `€${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** Same plan key resolution as GET /api/subscription?action=info (dashboard). */
function resolvePlanKeyForCustomer(email, subscriptionPlanDb) {
  if (email && String(email).toLowerCase() === UNLIMITED_EMAIL.toLowerCase()) return 'business';
  const p =
    subscriptionPlanDb != null && String(subscriptionPlanDb).trim() !== ''
      ? String(subscriptionPlanDb).toLowerCase().trim()
      : null;
  return p || 'free';
}

function resolveCustomerDisplayName(email, rawDisplayName) {
  const emailLocal = email && typeof email === 'string' ? email.split('@')[0] : '—';
  const raw = rawDisplayName != null ? String(rawDisplayName).trim() : '';
  if (!raw) return emailLocal;
  if (raw.includes('@')) return emailLocal;
  if (raw.toLowerCase() === String(emailLocal).toLowerCase()) return emailLocal;
  return raw;
}

export function formatProfileFullName(firstName, lastName) {
  const a = [firstName, lastName]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  return a.join(' ').trim();
}

let _userProfilesTableEnsured = false;

/**
 * Production safety: create user_profiles if migration was never applied.
 * Schema matches api/db/schema.sql (UUID user_id — NOT integer; users.id is UUID).
 */
export async function ensureUserProfilesTable() {
  if (!isBillingDbConfigured()) return;
  if (_userProfilesTableEnsured) return;
  const pool = getPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        phone VARCHAR(64),
        country VARCHAR(2),
        address TEXT,
        postal_code VARCHAR(32),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_user_profiles_country ON user_profiles (country)`
    );
    _userProfilesTableEnsured = true;
  } catch (e) {
    console.error('[billing] ensureUserProfilesTable failed', e);
    _userProfilesTableEnsured = false;
    throw e;
  }
}

async function ensureUserProfileRow(pool, userId) {
  await ensureUserProfilesTable();
  await pool.query(
    `INSERT INTO user_profiles (user_id) VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

function profileNameNeedsGoogleFix(value, email) {
  const v = value != null ? String(value).trim() : '';
  if (!v) return true;
  if (v.includes('@')) return true;
  const prefix = String(email || '')
    .split('@')[0]
    .toLowerCase();
  if (prefix && v.toLowerCase() === prefix) return true;
  return false;
}

export function isUserProfileIncompleteForOnboarding(row) {
  if (!row) return true;
  const keys = ['first_name', 'last_name', 'phone', 'country', 'address', 'postal_code'];
  return keys.some((k) => !row[k] || !String(row[k]).trim());
}

export async function getUserProfileApiPayload(email) {
  if (!email || !isBillingDbConfigured()) return null;
  await ensureUserProfilesTable();
  const pool = getPool();
  const r = await pool.query(
    `SELECT u.id AS user_id, u.email, up.first_name, up.last_name, up.phone, up.country, up.address, up.postal_code
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE lower(u.email) = lower($1)`,
    [email]
  );
  const row = r.rows[0];
  if (!row) return null;
  await ensureUserProfileRow(pool, row.user_id);
  const r2 = await pool.query(
    `SELECT u.email, up.first_name, up.last_name, up.phone, up.country, up.address, up.postal_code
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1::uuid`,
    [row.user_id]
  );
  const o = r2.rows[0];
  return {
    email: o.email,
    first_name: o.first_name || '',
    last_name: o.last_name || '',
    phone: o.phone || '',
    country: (o.country || '').toUpperCase().slice(0, 2),
    address: o.address || '',
    postal_code: o.postal_code || '',
    incomplete: isUserProfileIncompleteForOnboarding(o)
  };
}

export async function upsertUserProfileFromApi(email, body) {
  if (!email || !body || typeof body !== 'object' || !isBillingDbConfigured()) {
    return { ok: false, error: 'invalid_request' };
  }
  const em = String(body.email || '').trim().toLowerCase();
  if (!em) return { ok: false, error: 'email_required' };
  if (em !== String(email).trim().toLowerCase()) return { ok: false, error: 'email_mismatch' };

  try {
    await ensureUserProfilesTable();
    const pool = getPool();
    const uRes = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (!uRes.rows[0]) return { ok: false, error: 'not_found' };
    const userId = uRes.rows[0].id;
    await ensureUserProfileRow(pool, userId);

    const nz = (v, max) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      if (!s) return null;
      return s.slice(0, max);
    };
    const first = nz(body.first_name, 255);
    const last = nz(body.last_name, 255);
    const phone = nz(body.phone, 64);
    const countryRaw = nz(body.country, 8);
    const country = countryRaw ? countryRaw.toUpperCase().slice(0, 2) : null;
    const address = nz(body.address, 2000);
    const postal = nz(body.postal_code, 32);

    await pool.query(
      `UPDATE user_profiles SET
         first_name = $2,
         last_name = $3,
         phone = $4,
         country = $5,
         address = $6,
         postal_code = $7,
         updated_at = NOW()
       WHERE user_id = $1::uuid`,
      [userId, first, last, phone, country, address, postal]
    );

    const hasDn = await usersTableHasDisplayNameColumn(pool);
    if (hasDn && (first || last)) {
      const full = formatProfileFullName(first, last);
      if (full) {
        await pool.query('UPDATE users SET display_name = $2 WHERE id = $1::uuid', [
          userId,
          full.slice(0, 255)
        ]);
      }
    }

    return { ok: true, profile: await getUserProfileApiPayload(email) };
  } catch (e) {
    console.error('[billing] upsertUserProfileFromApi', e);
    return { ok: false, error: 'profile_error' };
  }
}

export async function mergeSessionUserWithProfile(sessionUser) {
  if (!sessionUser?.email || !isBillingDbConfigured()) return sessionUser;
  try {
    await ensureUserProfilesTable();
    const pool = getPool();
    const r = await pool.query(
      `SELECT up.first_name, up.last_name, u.display_name
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE lower(u.email) = lower($1)`,
      [sessionUser.email]
    );
    const row = r.rows[0];
    const full = formatProfileFullName(row?.first_name, row?.last_name);
    const firstOnly = row?.first_name != null ? String(row.first_name).trim() : '';
    let legacy = '';
    if (row?.display_name) {
      const d = String(row.display_name).trim();
      if (d && !d.includes('@')) legacy = d;
    }
    const sessionNameOk =
      sessionUser.name && !String(sessionUser.name).includes('@')
        ? String(sessionUser.name).trim()
        : '';
    const name =
      full ||
      firstOnly ||
      legacy ||
      sessionNameOk ||
      sessionUser.email.split('@')[0];
    return {
      ...sessionUser,
      name,
      first_name: row?.first_name || sessionUser.first_name,
      last_name: row?.last_name || sessionUser.last_name
    };
  } catch (e) {
    console.warn('[billing] mergeSessionUserWithProfile', e?.message);
    return sessionUser;
  }
}

let _usersDisplayNameExists;
async function usersTableHasDisplayNameColumn(pool) {
  if (_usersDisplayNameExists !== undefined) return _usersDisplayNameExists;
  try {
    const chk = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'display_name'
       LIMIT 1`
    );
    _usersDisplayNameExists = chk.rows.length > 0;
  } catch {
    _usersDisplayNameExists = false;
  }
  return _usersDisplayNameExists;
}

/**
 * After Google OAuth: fix bad stored names; set profile first/last from Google; sync display_name when column exists.
 */
export async function syncUserDisplayNameFromGoogleProfile(email, profile) {
  if (!email || !profile || !isBillingDbConfigured()) return;
  try {
    await ensureUserProfilesTable();
  } catch (e) {
    console.error('[billing] syncUserDisplayNameFromGoogleProfile ensure table', e);
    return;
  }
  const given = profile.given_name != null ? String(profile.given_name).trim() : '';
  const family = profile.family_name != null ? String(profile.family_name).trim() : '';
  let googleFull = [given, family].filter(Boolean).join(' ').trim();
  if (!googleFull && profile.name) googleFull = String(profile.name).trim();
  if (!googleFull) return;

  try {
  const pool = getPool();
  const userId = await ensureUserByEmail(email);
  await ensureUserProfileRow(pool, userId);

  const profRes = await pool.query(
    'SELECT first_name, last_name FROM user_profiles WHERE user_id = $1::uuid',
    [userId]
  );
  const curFirst = profRes.rows[0]?.first_name;
  const curLast = profRes.rows[0]?.last_name;
  const fullFromProfile = formatProfileFullName(curFirst, curLast);
  const oauthName = profile.name != null ? String(profile.name).trim() : '';
  const oauthDisplayUnreliable =
    !oauthName ||
    oauthName.includes('@') ||
    (email && oauthName.toLowerCase() === String(email).split('@')[0].toLowerCase());
  const shouldApplyGoogleNames =
    profileNameNeedsGoogleFix(curFirst, email) ||
    profileNameNeedsGoogleFix(fullFromProfile, email) ||
    (oauthDisplayUnreliable &&
      Boolean(googleFull) &&
      !profileNameNeedsGoogleFix(googleFull, email));

  if (shouldApplyGoogleNames) {
    const nextFirst = given || googleFull.split(/\s+/)[0] || googleFull;
    const nextLast =
      family ||
      (googleFull.includes(' ') ? googleFull.split(/\s+/).slice(1).join(' ').trim() : '') ||
      null;
    await pool.query(
      `UPDATE user_profiles SET first_name = $2, last_name = $3, updated_at = NOW() WHERE user_id = $1::uuid`,
      [userId, nextFirst.slice(0, 255), nextLast ? nextLast.slice(0, 255) : null]
    );
  } else if (family && (!curLast || !String(curLast).trim())) {
    await pool.query(
      `UPDATE user_profiles SET last_name = $2, updated_at = NOW() WHERE user_id = $1::uuid`,
      [userId, family.slice(0, 255)]
    );
  }

  const hasDn = await usersTableHasDisplayNameColumn(pool);
  if (hasDn) {
    const r = await pool.query('SELECT display_name FROM users WHERE id = $1::uuid', [userId]);
    const ex = r.rows[0]?.display_name != null ? String(r.rows[0].display_name).trim() : '';
    const prefix = String(email).split('@')[0].toLowerCase();
    if (!ex || ex.toLowerCase() === prefix || ex.includes('@')) {
      await pool.query('UPDATE users SET display_name = $2 WHERE id = $1::uuid', [
        userId,
        googleFull.slice(0, 255)
      ]);
    }
  }
  } catch (e) {
    console.error('[billing] syncUserDisplayNameFromGoogleProfile', e);
  }
}

/** Avoid referencing optional columns (e.g. users.role) until we know they exist. */
let _usersRoleColumnExists;
async function usersTableHasRoleColumn(pool) {
  if (_usersRoleColumnExists !== undefined) return _usersRoleColumnExists;
  try {
    const chk = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
       LIMIT 1`
    );
    _usersRoleColumnExists = chk.rows.length > 0;
  } catch {
    _usersRoleColumnExists = false;
  }
  return _usersRoleColumnExists;
}

function isExcludedCustomerRole(roleVal) {
  if (roleVal == null || roleVal === '') return false;
  const r = String(roleVal).trim().toLowerCase();
  return r === 'admin' || r === 'super_admin';
}

export async function getAdminUsersDb({ search = '', plan = 'all', limit = 200, forUserId = null } = {}) {
  await ensureUserProfilesTable();
  if (isBillingDbConfigured()) {
    const { ensureAccountSecuritySchema } = await import('./account-security-repository.js');
    await ensureAccountSecuritySchema();
  }
  const pool = getPool();
  const filters = [];
  const params = [];
  filters.push(`NOT EXISTS (SELECT 1 FROM admins a WHERE lower(a.email) = lower(u.email))`);

  const [hasRoleCol, hasDisplayCol] = await Promise.all([
    usersTableHasRoleColumn(pool),
    usersTableHasDisplayNameColumn(pool)
  ]);
  if (hasRoleCol) {
    filters.push(
      `(u.role IS NULL OR TRIM(u.role::text) = '' OR LOWER(TRIM(u.role::text)) NOT IN ('admin', 'super_admin'))`
    );
  }

  if (forUserId) {
    params.push(String(forUserId).trim());
    filters.push(`u.id = $${params.length}::uuid`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const idx = params.length;
    const searchParts = [`LOWER(u.email) LIKE $${idx}`];
    if (hasDisplayCol) searchParts.push(`LOWER(COALESCE(u.display_name, '')) LIKE $${idx}`);
    searchParts.push(
      `LOWER(TRIM(CONCAT(COALESCE(up.first_name, ''), ' ', COALESCE(up.last_name, '')))) LIKE $${idx}`
    );
    searchParts.push(`LOWER(COALESCE(up.phone, '')) LIKE $${idx}`);
    filters.push(`(${searchParts.join(' OR ')})`);
  }
  if (plan && plan !== 'all') {
    params.push(String(plan).toLowerCase().trim());
    filters.push(
      `LOWER(TRIM(COALESCE(
        NULLIF(TRIM(COALESCE(s.plan::text, '')), ''),
        NULLIF(TRIM(COALESCE(lp.last_pay_plan_key::text, '')), ''),
        'free'
      ))) = $${params.length}`
    );
  }
  const lim = forUserId ? 1 : Math.min(Math.max(Number(limit) || 200, 1), 500);
  params.push(lim);
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const roleSelect = hasRoleCol ? 'u.role AS user_role,' : 'NULL::text AS user_role,';
  const displaySelect = hasDisplayCol ? 'u.display_name AS user_display_name,' : 'NULL::text AS user_display_name,';

  const r = await pool.query(
    `SELECT
       u.id AS user_id,
       u.email,
       ${roleSelect}
       ${displaySelect}
       s.id AS subscription_id,
       s.plan AS subscription_plan,
       s.status AS subscription_status,
       s.billing_period AS subscription_billing_period,
       s.current_period_end AS subscription_current_period_end,
       s.created_at AS subscription_created_at,
       lp.last_pay_at,
       lp.last_pay_amount,
       lp.last_pay_currency,
       lp.last_pay_plan_key,
       u.created_at,
       COALESCE(u.account_status, 'active') AS account_status,
       u.deleted_at,
       u.deletion_reason,
       us.minutes_used,
       COALESCE(so.saved_count, 0)::int AS saved_outputs_count,
       last_h.created_at AS last_activity_at,
       up.first_name AS prof_first_name,
       up.last_name AS prof_last_name,
       up.phone AS prof_phone,
       up.country AS prof_country,
       up.address AS prof_address,
       up.postal_code AS prof_postal_code,
       cooldown.blocked_until AS cooldown_blocked_until,
       cooldown.reason AS cooldown_reason
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT blocked_until, reason
       FROM deleted_account_cooldowns dac
       WHERE dac.email_normalized = lower(u.email)
         AND dac.blocked_until > NOW()
       ORDER BY dac.blocked_until DESC
       LIMIT 1
     ) cooldown ON true
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN usage us ON us.user_id = u.id
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS saved_count FROM saved_outputs GROUP BY user_id
     ) so ON so.user_id = u.id
     LEFT JOIN (
       SELECT user_id, MAX(created_at) AS created_at FROM usage_history GROUP BY user_id
     ) last_h ON last_h.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT
         p.created_at AS last_pay_at,
         p.amount AS last_pay_amount,
         p.currency AS last_pay_currency,
         p.plan_key AS last_pay_plan_key
       FROM payments p
       WHERE p.user_id = u.id AND p.status = 'success'
       ORDER BY p.created_at DESC
       LIMIT 1
     ) lp ON true
     ${whereSql}
     ORDER BY u.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return r.rows
    .map((row) => {
      const hasSubscriptionRow = Boolean(row.subscription_id);
      const planFromSubscription =
        row.subscription_plan != null && String(row.subscription_plan).trim() !== ''
          ? row.subscription_plan
          : null;
      const planFromLastPayment =
        row.last_pay_plan_key != null && String(row.last_pay_plan_key).trim() !== ''
          ? row.last_pay_plan_key
          : null;
      const effectivePlanKey = planFromSubscription || planFromLastPayment;
      const planResolved = resolvePlanKeyForCustomer(row.email, effectivePlanKey);
      const subPlan = planResolved;

      const accountStatusDb = String(row.account_status || 'active').toLowerCase();
      const cooldownUntilRaw = row.cooldown_blocked_until;
      const cooldownUntilIso = cooldownUntilRaw?.toISOString
        ? cooldownUntilRaw.toISOString()
        : cooldownUntilRaw || null;
      const hasActiveCooldown =
        cooldownUntilRaw && new Date(cooldownUntilRaw).getTime() > Date.now();
      const hasDeletedAt = Boolean(row.deleted_at);
      const isAccountDeactivated =
        accountStatusDb === 'deactivated' ||
        accountStatusDb === 'banned' ||
        hasDeletedAt ||
        hasActiveCooldown;
      const accountStatus = isAccountDeactivated ? 'deactivated' : 'active';

      if (isAccountDeactivated) {
        console.log('[admin-user-status]', {
          email: row.email,
          active: false,
          cooldown: hasActiveCooldown,
          deleted: hasDeletedAt || accountStatusDb === 'deactivated' || accountStatusDb === 'banned'
        });
      }

      const uiStatus =
        isAccountDeactivated
          ? 'deactivated'
          : hasSubscriptionRow &&
              String(row.subscription_status || 'active').toLowerCase() === 'canceled'
            ? 'inactive'
            : 'active';

      const profile = {
        first_name: row.prof_first_name || '',
        last_name: row.prof_last_name || '',
        phone: row.prof_phone || '',
        country: row.prof_country || '',
        address: row.prof_address || '',
        postal_code: row.prof_postal_code || ''
      };
      const profileFull = formatProfileFullName(row.prof_first_name, row.prof_last_name);
      const name =
        profileFull || resolveCustomerDisplayName(row.email, row.user_display_name);
      const role = row.user_role != null && String(row.user_role).trim() !== '' ? String(row.user_role).trim() : null;

      const needsSyntheticSub =
        !hasSubscriptionRow && String(row.email).toLowerCase() === UNLIMITED_EMAIL.toLowerCase();

      let subscriptionObj = null;
      if (hasSubscriptionRow) {
        subscriptionObj = {
          plan: subPlan,
          planLabel: planLabelForAdmin(subPlan),
          priceLabel: subscriptionPriceLabel(subPlan),
          billingPeriod: row.subscription_billing_period || 'monthly',
          startedAt: row.subscription_created_at?.toISOString
            ? row.subscription_created_at.toISOString()
            : row.subscription_created_at,
          currentPeriodEnd: row.subscription_current_period_end?.toISOString
            ? row.subscription_current_period_end.toISOString()
            : row.subscription_current_period_end || null,
          rawStatus: row.subscription_status || 'active'
        };
      } else if (needsSyntheticSub) {
        const end = new Date();
        end.setFullYear(end.getFullYear() + 10);
        subscriptionObj = {
          plan: 'business',
          planLabel: planLabelForAdmin('business'),
          priceLabel: subscriptionPriceLabel('business'),
          billingPeriod: 'annual',
          startedAt: new Date().toISOString(),
          currentPeriodEnd: end.toISOString(),
          rawStatus: 'active'
        };
      }

      return {
        id: row.user_id,
        email: row.email,
        role: role || undefined,
        name,
        profile,
        plan: planResolved,
        planLabel: planLabelForAdmin(planResolved),
        status: uiStatus,
        accountStatus,
        accountStatusDb,
        cooldownActive: hasActiveCooldown,
        cooldownUntil: cooldownUntilIso,
        cooldownReason: row.cooldown_reason || null,
        deletedAt: row.deleted_at?.toISOString ? row.deleted_at.toISOString() : row.deleted_at || null,
        deletionReason: row.deletion_reason || null,
        subscription: subscriptionObj,
        lastPayment:
          row.last_pay_at
            ? {
                at: row.last_pay_at?.toISOString ? row.last_pay_at.toISOString() : row.last_pay_at,
                amount: row.last_pay_amount != null ? Number(row.last_pay_amount) : null,
                currency: row.last_pay_currency || 'EUR',
                planKey: row.last_pay_plan_key || null
              }
            : null,
        createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
        lastActivityAt: row.last_activity_at?.toISOString ? row.last_activity_at.toISOString() : row.last_activity_at,
        usageMinutesThisMonth: Number(row.minutes_used || 0),
        savedOutputsCount: Number(row.saved_outputs_count || 0)
      };
    })
    .filter((user) => !isExcludedCustomerRole(user.role));
}

/** Single customer row for PATCH response (same shape as list items). */
export async function getAdminCustomerSnapshotById(userId) {
  const rows = await getAdminUsersDb({ forUserId: userId, limit: 1 });
  return rows[0] || null;
}

function nzAdminPatch(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Update customer profile + subscription (panel users only; blocked for rows that match admins email).
 */
export async function adminPatchCustomerUser(userId, patch = {}) {
  try {
    await ensureUserProfilesTable();
  } catch (e) {
    console.error('[billing] adminPatchCustomerUser ensureUserProfilesTable', e);
    return { ok: false, error: 'profile_error' };
  }
  const pool = getPool();
  const uid = String(userId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)) {
    return { ok: false, error: 'invalid_id' };
  }
  const uRes = await pool.query('SELECT id, email FROM users WHERE id = $1::uuid', [uid]);
  if (!uRes.rows[0]) return { ok: false, error: 'not_found' };
  let accountEmail = uRes.rows[0].email;
  const adm = await pool.query('SELECT 1 FROM admins WHERE lower(email) = lower($1)', [accountEmail]);
  if (adm.rows.length) return { ok: false, error: 'cannot_edit_admin' };

  const {
    name,
    plan,
    status,
    account_status: accountStatusPatch,
    email: emailPatch,
    first_name,
    last_name,
    phone,
    country,
    address,
    postal_code
  } = patch;

  const nameStr = name !== undefined ? String(name).trim().slice(0, 255) : undefined;
  const planStr = plan !== undefined ? String(plan).trim().toLowerCase() : undefined;
  const statusStr = status !== undefined ? String(status).trim().toLowerCase() : undefined;

  if (planStr !== undefined && !ADMIN_CUSTOMER_PLAN_KEYS.has(planStr)) {
    return { ok: false, error: 'invalid_plan' };
  }
  if (statusStr !== undefined && !['active', 'inactive'].includes(statusStr)) {
    return { ok: false, error: 'invalid_status' };
  }
  const accountStatusStr =
    accountStatusPatch !== undefined ? String(accountStatusPatch).trim().toLowerCase() : undefined;
  if (
    accountStatusStr !== undefined &&
    !['active', 'deactivated', 'banned'].includes(accountStatusStr)
  ) {
    return { ok: false, error: 'invalid_account_status' };
  }

  const anyProfileField = [
    first_name,
    last_name,
    phone,
    country,
    address,
    postal_code
  ].some((x) => x !== undefined);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (emailPatch !== undefined) {
      const newEm = String(emailPatch).trim().toLowerCase();
      if (!newEm || !newEm.includes('@')) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'invalid_email' };
      }
      if (newEm !== String(accountEmail).toLowerCase()) {
        const clash = await client.query(
          'SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2::uuid',
          [newEm, uid]
        );
        if (clash.rows.length) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'email_taken' };
        }
        await client.query('UPDATE users SET email = $2 WHERE id = $1::uuid', [uid, newEm]);
        accountEmail = newEm;
      }
    }

    if (anyProfileField) {
      await client.query(
        `INSERT INTO user_profiles (user_id) VALUES ($1::uuid) ON CONFLICT (user_id) DO NOTHING`,
        [uid]
      );
      const curP = await client.query(
        `SELECT first_name, last_name, phone, country, address, postal_code
         FROM user_profiles WHERE user_id = $1::uuid FOR UPDATE`,
        [uid]
      );
      const r = curP.rows[0] || {};
      const pFirst = first_name !== undefined ? nzAdminPatch(first_name, 255) : r.first_name ?? null;
      const pLast = last_name !== undefined ? nzAdminPatch(last_name, 255) : r.last_name ?? null;
      const pPhone = phone !== undefined ? nzAdminPatch(phone, 64) : r.phone ?? null;
      let pCountry = country !== undefined ? nzAdminPatch(country, 8) : r.country ?? null;
      if (pCountry) pCountry = String(pCountry).toUpperCase().slice(0, 2);
      const pAddr = address !== undefined ? nzAdminPatch(address, 2000) : r.address ?? null;
      const pPostal = postal_code !== undefined ? nzAdminPatch(postal_code, 32) : r.postal_code ?? null;
      await client.query(
        `UPDATE user_profiles SET
           first_name = $2,
           last_name = $3,
           phone = $4,
           country = $5,
           address = $6,
           postal_code = $7,
           updated_at = NOW()
         WHERE user_id = $1::uuid`,
        [uid, pFirst, pLast, pPhone, pCountry, pAddr, pPostal]
      );
      const hasDn = await usersTableHasDisplayNameColumn(pool);
      if (hasDn) {
        const full = formatProfileFullName(pFirst, pLast);
        if (full) {
          await client.query('UPDATE users SET display_name = $2 WHERE id = $1::uuid', [
            uid,
            full.slice(0, 255)
          ]);
        }
      }
    }

    if (nameStr !== undefined) {
      const hasDn = await usersTableHasDisplayNameColumn(pool);
      if (hasDn) {
        await client.query('UPDATE users SET display_name = $2 WHERE id = $1::uuid', [
          uid,
          nameStr === '' ? null : nameStr
        ]);
      }
    }
    if (accountStatusStr !== undefined) {
      if (accountStatusStr === 'active') {
        await client.query(
          `UPDATE users SET account_status = 'active', deleted_at = NULL, deletion_reason = NULL WHERE id = $1::uuid`,
          [uid]
        );
        await client.query(
          `DELETE FROM deleted_account_cooldowns WHERE email_normalized = lower($1)`,
          [accountEmail]
        );
        console.log('[account-restored]', { userId: uid, email: accountEmail });
      } else {
        await client.query(
          `UPDATE users
           SET account_status = $2,
               deleted_at = COALESCE(deleted_at, NOW()),
               deletion_reason = COALESCE(deletion_reason, 'admin_set')
           WHERE id = $1::uuid`,
          [uid, accountStatusStr]
        );
      }
    }
    if (planStr !== undefined || statusStr !== undefined) {
      const cur = await client.query(
        'SELECT plan, status FROM subscriptions WHERE user_id = $1::uuid FOR UPDATE',
        [uid]
      );
      const nextPlan = planStr !== undefined ? planStr : cur.rows[0]?.plan || 'free';
      let nextSubStatus = cur.rows[0]?.status || 'active';
      if (statusStr === 'inactive') nextSubStatus = 'canceled';
      if (statusStr === 'active') nextSubStatus = 'active';
      if (!cur.rows.length) {
        await client.query(
          `INSERT INTO subscriptions (user_id, plan, status, billing_period, updated_at)
           VALUES ($1::uuid, $2, $3, 'monthly', NOW())`,
          [uid, nextPlan, nextSubStatus]
        );
      } else {
        await client.query(
          `UPDATE subscriptions SET plan = $2, status = $3, updated_at = NOW() WHERE user_id = $1::uuid`,
          [uid, nextPlan, nextSubStatus]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  let user = null;
  try {
    user = await getAdminCustomerSnapshotById(uid);
  } catch (e) {
    console.error('[adminPatchCustomerUser] snapshot failed', e);
  }
  return { ok: true, user };
}

export async function adminDeleteCustomerUser(userId) {
  const { deleteCustomerAccountCompletely } = await import('./account-security-repository.js');
  return deleteCustomerAccountCompletely(userId, { deletionReason: 'admin_deleted' });
}

export async function getAdminUsageDb({ type = 'all', platform = 'all', startDate = '', endDate = '', limit = 300 } = {}) {
  const pool = getPool();
  const params = [];
  const where = [];
  if (type && type !== 'all') {
    params.push(type);
    where.push(`h.type = $${params.length}`);
  }
  if (platform && platform !== 'all') {
    params.push(platform.toLowerCase());
    where.push(`LOWER(COALESCE(h.metadata->>'platform', h.metadata->>'source', 'unknown')) = $${params.length}`);
  }
  if (startDate) {
    params.push(startDate);
    where.push(`h.created_at >= $${params.length}::timestamptz`);
  }
  if (endDate) {
    params.push(endDate);
    where.push(`h.created_at <= $${params.length}::timestamptz`);
  }
  params.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT
       h.id,
       h.type,
       h.minutes,
       h.metadata,
       h.created_at,
       u.email
     FROM usage_history h
     JOIN users u ON u.id = h.user_id
     ${whereSql}
     ORDER BY h.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    minutes: Number(row.minutes || 0),
    metadata: row.metadata || {},
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    email: row.email
  }));
}

export async function getAdminSavedOutputsDb({ limit = 300 } = {}) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.*, u.email
     FROM saved_outputs s
     JOIN users u ON u.id = s.user_id
     ORDER BY s.is_favorite DESC, s.created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 300, 1), 1000)]
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    type: row.type,
    title: row.title,
    platform: row.platform,
    sourceUrl: row.source_url,
    language: row.language,
    content: row.content,
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at
  }));
}

export async function getAdminPaymentsSnapshotDb() {
  const pool = getPool();
  const [distributionRes, paidRes] = await Promise.all([
    pool.query(`SELECT COALESCE(plan, 'free') AS plan, COUNT(*)::int AS count FROM subscriptions GROUP BY plan ORDER BY plan ASC`),
    pool.query(`SELECT COUNT(*)::int AS count FROM subscriptions WHERE COALESCE(plan, 'free') <> 'free'`)
  ]);
  return {
    planDistribution: distributionRes.rows.map((r) => ({ plan: r.plan, count: Number(r.count || 0) })),
    paidUsers: Number(paidRes.rows[0]?.count || 0)
  };
}

export async function listAdminBlogPostsDb(limit = 200) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT *
     FROM blog_posts
     ORDER BY updated_at DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 200, 1), 500)]
  );
  return r.rows.map((row) => mapBlogPostRow(row));
}

function mapBlogPostRow(row) {
  return {
    id: String(row.id),
    slug: row.slug,
    title: row.title,
    coverImageUrl: row.cover_image_url,
    excerpt: row.excerpt,
    content: row.content,
    status: row.status,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    htmlPath: row.html_path || null,
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at?.toISOString ? row.updated_at.toISOString() : row.updated_at,
    publishedAt: row.published_at?.toISOString ? row.published_at.toISOString() : row.published_at,
    contentHtml: row.content_html || null,
    readingTimeMinutes:
      row.reading_time_minutes != null ? Number(row.reading_time_minutes) : null,
    seoTitle: row.seo_title || null,
    ogImageUrl: row.og_image_url || null,
    authorEmail: row.author_email || null
  };
}

export async function listPublishedBlogPostsDb(limit = 200) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT *
     FROM blog_posts
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST, updated_at DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 200, 1), 500)]
  );
  return r.rows.map((row) => mapBlogPostRow(row));
}

export async function getBlogPostByIdDb(id) {
  const pool = getPool();
  const idStr = String(id || '').trim();
  if (!idStr) return null;
  const r = await pool.query('SELECT * FROM blog_posts WHERE id = $1::bigint LIMIT 1', [idStr]);
  return r.rows[0] ? mapBlogPostRow(r.rows[0]) : null;
}

export async function getBlogPostBySlugDb(slug) {
  const pool = getPool();
  const s = String(slug || '').trim();
  if (!s) return null;
  const r = await pool.query('SELECT * FROM blog_posts WHERE slug = $1::text LIMIT 1', [s]);
  return r.rows[0] ? mapBlogPostRow(r.rows[0]) : null;
}

export async function updateBlogPostHtmlPathDb(id, htmlPath) {
  const pool = getPool();
  const idStr = String(id || '').trim();
  if (!idStr) return;
  try {
    await pool.query(
      `UPDATE blog_posts SET html_path = $2::text, updated_at = NOW() WHERE id = $1::bigint`,
      [idStr, htmlPath || null]
    );
  } catch (err) {
    if (!String(err?.message || '').toLowerCase().includes('html_path')) throw err;
    console.warn('[blog] html_path column missing — run schema-blog-html-path.sql');
  }
}

async function resolveAdminBlogPostTargetId(pool, explicitId, slug) {
  const idStr = explicitId != null && String(explicitId).trim() !== '' ? String(explicitId).trim() : '';
  if (idStr) {
    const byId = await pool.query('SELECT id FROM blog_posts WHERE id = $1::bigint LIMIT 1', [idStr]);
    if (byId.rows.length) return String(byId.rows[0].id);
  }
  const bySlug = await pool.query('SELECT id FROM blog_posts WHERE slug = $1::text LIMIT 1', [slug]);
  if (bySlug.rows.length) return String(bySlug.rows[0].id);
  return null;
}

export async function saveAdminBlogPostDb(payload = {}) {
  const pool = getPool();
  const {
    id = null,
    slug,
    title,
    coverImageUrl = '',
    excerpt = '',
    content = '',
    status = 'draft',
    category = '',
    tags = [],
    metaTitle = '',
    metaDescription = '',
    canonicalUrl = '',
    ogTitle = '',
    ogDescription = ''
  } = payload;
  if (!slug || !title) {
    throw new Error('slug_and_title_required');
  }
  const rawStatus = String(status || 'draft').toLowerCase();
  const cmsStatuses = new Set(['draft', 'published', 'scheduled', 'archived', 'trash']);
  const normalizedStatus = cmsStatuses.has(rawStatus)
    ? rawStatus
    : rawStatus === 'deleted'
      ? 'trash'
      : 'draft';
  const cleanTags = Array.isArray(tags)
    ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30)
    : [];
  const publishedAtParam = normalizedStatus === 'published' ? new Date() : null;

  const targetId = await resolveAdminBlogPostTargetId(pool, id, slug);

  if (targetId) {
    console.log('[blog] update post', { id: targetId, slug, status: normalizedStatus, hasCover: Boolean(coverImageUrl) });
    try {
      const updated = await pool.query(
        `UPDATE blog_posts
         SET slug = $2::text,
             title = $3::text,
             cover_image_url = $4::text,
             excerpt = $5::text,
             content = $6::text,
             status = $7::text,
             category = $8::text,
             tags = $9::text[],
             meta_title = $10::text,
             meta_description = $11::text,
             canonical_url = $12::text,
             og_title = $13::text,
             og_description = $14::text,
             updated_at = NOW(),
             published_at = CASE
               WHEN $15::text = 'published' THEN COALESCE(published_at, NOW())
               ELSE NULL::timestamptz
             END
         WHERE id = $1::bigint
         RETURNING id`,
        [targetId, slug, title, coverImageUrl, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription, normalizedStatus]
      );
      return String(updated.rows[0].id);
    } catch (err) {
      // Backward-compatible fallback when DB migration for cover_image_url is not applied yet.
      if (!String(err?.message || '').toLowerCase().includes('cover_image_url')) throw err;
      console.warn('[blog] cover_image_url missing, retrying update without cover column');
      const updated = await pool.query(
        `UPDATE blog_posts
         SET slug = $2::text,
             title = $3::text,
             excerpt = $4::text,
             content = $5::text,
             status = $6::text,
             category = $7::text,
             tags = $8::text[],
             meta_title = $9::text,
             meta_description = $10::text,
             canonical_url = $11::text,
             og_title = $12::text,
             og_description = $13::text,
             updated_at = NOW(),
             published_at = CASE
               WHEN $14::text = 'published' THEN COALESCE(published_at, NOW())
               ELSE NULL::timestamptz
             END
         WHERE id = $1::bigint
         RETURNING id`,
        [targetId, slug, title, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription, normalizedStatus]
      );
      return String(updated.rows[0].id);
    }
  }
  console.log('[blog] insert post', { slug, status: normalizedStatus, hasCover: Boolean(coverImageUrl) });
  try {
    const inserted = await pool.query(
      `INSERT INTO blog_posts
        (slug, title, cover_image_url, excerpt, content, status, category, tags, meta_title, meta_description, canonical_url, og_title, og_description, published_at)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text[],$9::text,$10::text,$11::text,$12::text,$13::text,$14::timestamptz)
       RETURNING id`,
      [slug, title, coverImageUrl, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription, publishedAtParam]
    );
    return String(inserted.rows[0].id);
  } catch (err) {
    if (!String(err?.message || '').toLowerCase().includes('cover_image_url')) throw err;
    console.warn('[blog] cover_image_url missing, retrying insert without cover column');
    const inserted = await pool.query(
      `INSERT INTO blog_posts
        (slug, title, excerpt, content, status, category, tags, meta_title, meta_description, canonical_url, og_title, og_description, published_at)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text[],$8::text,$9::text,$10::text,$11::text,$12::text,$13::timestamptz)
       RETURNING id`,
      [slug, title, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription, publishedAtParam]
    );
    return String(inserted.rows[0].id);
  }
}

export async function publishAdminBlogPostDb(id, publish = true) {
  const pool = getPool();
  const statusText = publish ? 'published' : 'draft';
  const idStr = id != null && String(id).trim() !== '' ? String(id).trim() : '';
  if (!idStr) return false;
  const r = await pool.query(
    `UPDATE blog_posts
     SET status = $2::text,
         updated_at = NOW(),
         published_at = CASE
           WHEN $3::text = 'published' THEN COALESCE(published_at, NOW())
           ELSE NULL::timestamptz
         END
     WHERE id = $1::bigint
     RETURNING id`,
    [idStr, statusText, statusText]
  );
  return r.rows.length > 0;
}

export async function canUseFeatureDb(email, feature, videoDurationMinutes = 0) {
  if (email === UNLIMITED_EMAIL) {
    return { allowed: true };
  }

  await ensureUserByEmail(email);
  const sub = await getSubscriptionRowByEmail(email);
  const planKey = resolvePlanKey(sub?.plan || 'free');
  const plan = getPlanDef(planKey);
  if (!plan) {
    return { allowed: false, reason: 'Invalid plan state.' };
  }

  let featureKey = feature;
  if (feature === 'srt' || feature === 'subtitles') featureKey = 'srt';
  if (feature === 'downloadAudio' || feature === 'downloadVideo') {
    featureKey = feature === 'downloadAudio' ? 'downloadAudio' : 'downloadVideo';
  }

  if (!plan.features[featureKey]) {
    return { allowed: false, reason: 'This feature is not available on your current plan.' };
  }

  if (planKey !== 'free') {
    if (sub.status === 'past_due') {
      return { allowed: false, reason: 'Subscription is past due. Update your payment method.' };
    }
    if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
      return { allowed: false, reason: 'Your subscription has expired. Please renew to continue.' };
    }
  }

  const pool = getPool();
  const uid = (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
  const usage = await getNormalizedUsage(uid);

  if (feature === 'downloadAudio' || feature === 'downloadVideo') {
    const isAudio = feature === 'downloadAudio';
    const limit = isAudio ? plan.downloadAudioLimit : plan.downloadVideoLimit;
    if (limit != null) {
      const count = isAudio ? usage.audioDownloads : usage.videoDownloads;
      if (count >= limit) {
        return {
          allowed: false,
          reason: `Your monthly ${isAudio ? 'audio' : 'video'} download limit (${limit}) is reached. Upgrade for more.`
        };
      }
    }
    return { allowed: true };
  }

  const genLimit =
    plan.monthlyGenerationLimit != null ? plan.monthlyGenerationLimit : plan.monthlyLimit;
  const maxJob = plan.maxJobMinutes != null ? plan.maxJobMinutes : 180;
  const usedGens = usage.monthlyMinutes;

  if (feature === 'transcription') {
    if (usedGens + 1 > genLimit) {
      return {
        allowed: false,
        reason: `You've used all ${genLimit} included generations this month. Upgrade for more capacity.`
      };
    }
    if (videoDurationMinutes > maxJob) {
      return {
        allowed: false,
        reason: `This run exceeds the maximum length for one generation on your plan (${maxJob} minutes). Try a shorter clip or upgrade.`
      };
    }
    return { allowed: true };
  }

  if (feature === 'summarization' || feature === 'srt' || feature === 'subtitles') {
    if (usedGens >= genLimit) {
      return {
        allowed: false,
        reason: `You've used all ${genLimit} included generations this month. Upgrade for more capacity.`
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

/** DB user UUID for billing row, or null. */
export async function getUserIdByEmail(email) {
  if (!email || !isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return r.rows[0]?.id || null;
}

function trimRetentionRecentForOwner(client, userId, guestKey) {
  if (userId) {
    return client.query(
      `DELETE FROM retention_recent_activity a
       USING (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
           FROM retention_recent_activity
           WHERE user_id = $1::uuid AND guest_key IS NULL
         ) sub
         WHERE sub.rn > 5
       ) d
       WHERE a.id = d.id`,
      [userId]
    );
  }
  return client.query(
    `DELETE FROM retention_recent_activity a
     USING (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
         FROM retention_recent_activity
         WHERE guest_key = $1 AND user_id IS NULL
       ) sub
       WHERE sub.rn > 5
     ) d
     WHERE a.id = d.id`,
    [guestKey]
  );
}

export async function retentionInsertRecent({ userId, guestKey, url, title, platform, createdAt }) {
  if (!isBillingDbConfigured()) return;
  if (!url || (!userId && !guestKey)) return;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO retention_recent_activity (user_id, guest_key, url, title, platform, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5, COALESCE(to_timestamp($6::bigint / 1000.0), NOW()))`,
      [userId, guestKey, url, title || null, platform || null, createdAt || Date.now()]
    );
    await trimRetentionRecentForOwner(client, userId, guestKey);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function retentionIncrementUsage({ userId, guestKey, lastUsedAtMs }) {
  if (!isBillingDbConfigured()) return;
  if (!userId && !guestKey) return;
  const pool = getPool();
  const ts = lastUsedAtMs ? new Date(Number(lastUsedAtMs)) : new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      const ex = await client.query(
        'SELECT id, count FROM retention_usage_stats WHERE user_id = $1::uuid FOR UPDATE',
        [userId]
      );
      if (ex.rows.length) {
        await client.query(
          `UPDATE retention_usage_stats
           SET count = count + 1, last_used_at = GREATEST(last_used_at, $2::timestamptz)
           WHERE user_id = $1::uuid`,
          [userId, ts]
        );
      } else {
        await client.query(
          `INSERT INTO retention_usage_stats (user_id, guest_key, count, last_used_at)
           VALUES ($1::uuid, NULL, 1, $2::timestamptz)`,
          [userId, ts]
        );
      }
    } else {
      const ex = await client.query(
        'SELECT id, count FROM retention_usage_stats WHERE guest_key = $1 FOR UPDATE',
        [guestKey]
      );
      if (ex.rows.length) {
        await client.query(
          `UPDATE retention_usage_stats
           SET count = count + 1, last_used_at = GREATEST(last_used_at, $2::timestamptz)
           WHERE guest_key = $1`,
          [guestKey, ts]
        );
      } else {
        await client.query(
          `INSERT INTO retention_usage_stats (user_id, guest_key, count, last_used_at)
           VALUES (NULL, $1, 1, $2::timestamptz)`,
          [guestKey, ts]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Attach guest retention rows to the logged-in user. Clears guest_key on recent rows;
 * adds guest usage count to user row (or creates it).
 */
export async function mergeRetentionGuestToUser(guestKey, email) {
  if (!isBillingDbConfigured() || !guestKey || !email) {
    return { merged: false, reason: 'skip' };
  }
  await ensureUserByEmail(email);
  const userId = await getUserIdByEmail(email);
  if (!userId) return { merged: false, reason: 'no_user' };

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE retention_recent_activity
       SET user_id = $1::uuid, guest_key = NULL
       WHERE guest_key = $2 AND user_id IS NULL`,
      [userId, guestKey]
    );

    const g = await client.query(
      'SELECT id, count, last_used_at FROM retention_usage_stats WHERE guest_key = $1 AND user_id IS NULL FOR UPDATE',
      [guestKey]
    );
    if (g.rows.length) {
      const add = Number(g.rows[0].count) || 0;
      const glu = g.rows[0].last_used_at;
      await client.query('DELETE FROM retention_usage_stats WHERE id = $1', [g.rows[0].id]);

      const u = await client.query(
        'SELECT id, count, last_used_at FROM retention_usage_stats WHERE user_id = $1::uuid FOR UPDATE',
        [userId]
      );
      if (u.rows.length) {
        await client.query(
          `UPDATE retention_usage_stats
           SET count = count + $2, last_used_at = GREATEST(last_used_at, $3::timestamptz)
           WHERE user_id = $1::uuid`,
          [userId, add, glu]
        );
      } else {
        await client.query(
          `INSERT INTO retention_usage_stats (user_id, guest_key, count, last_used_at)
           VALUES ($1::uuid, NULL, $2, $3::timestamptz)`,
          [userId, Math.max(1, add), glu]
        );
      }
    }

    await trimRetentionRecentForOwner(client, userId, null);

    await client.query('COMMIT');
    return { merged: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Pending payment row; plan_key is source of truth for upgrades (not amount). */
export async function insertPaymentPending({
  email,
  provider,
  amount,
  amountIrr = null,
  currency,
  externalId,
  providerOrderId = null,
  planKey,
  discountCode,
  originalAmountEur = null,
  discountAmountEur = null,
  finalAmountEur = null,
  appliedOfferId = null
}) {
  const userId = await ensureUserByEmail(email);
  const pool = getPool();
  const pk = planKey && getPlanDef(planKey) ? String(resolvePlanKey(planKey)).slice(0, 32) : null;
  const dc = discountCode ? String(discountCode).slice(0, 32) : null;
  const orderId = providerOrderId ? String(providerOrderId).slice(0, 64) : null;
  const r = await pool.query(
    `INSERT INTO payments (
      user_id, provider, gateway, status, amount, amount_eur, amount_irr, currency,
      external_id, authority, plan_key, plan, discount_code, provider_order_id
     )
     VALUES ($1, $2, $2, 'pending', $3, $9, $4, $5, $6, $6, $7, $7, $8, $10)
     RETURNING id`,
    [
      userId,
      String(provider || 'stripe').slice(0, 64),
      amount != null ? Number(amount) : null,
      amountIrr != null ? Number(amountIrr) : null,
      String(currency || 'EUR').slice(0, 8),
      externalId ? String(externalId).slice(0, 255) : null,
      pk,
      dc,
      finalAmountEur != null ? Number(finalAmountEur) : (amount != null ? Number(amount) : null),
      orderId
    ]
  );
  await pool.query(
    `UPDATE payments
     SET original_amount_eur = COALESCE($2::numeric, original_amount_eur),
         discount_amount_eur = COALESCE($3::numeric, discount_amount_eur),
         final_amount_eur = COALESCE($4::numeric, final_amount_eur),
         applied_offer_id = COALESCE($5::uuid, applied_offer_id)
     WHERE id = $1::uuid`,
    [
      r.rows[0].id,
      originalAmountEur != null ? Number(originalAmountEur) : null,
      discountAmountEur != null ? Number(discountAmountEur) : null,
      finalAmountEur != null ? Number(finalAmountEur) : null,
      appliedOfferId || null
    ]
  );
  return r.rows[0].id;
}

export async function createPaymentAttempt({ paymentId, userId, attemptNumber = 1, status = 'pending', errorMessage = null }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO payment_attempts (user_id, payment_id, attempt_number, status, error_message)
     VALUES ($1::uuid, $2::uuid, $3::int, $4::text, $5)`,
    [userId, paymentId, Number(attemptNumber) || 1, String(status || 'pending'), errorMessage]
  );
}

export async function markPaymentAttemptStatus(paymentId, attemptNumber, status, errorMessage = null) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payment_attempts
     SET status = $3, error_message = $4
     WHERE payment_id = $1::uuid AND attempt_number = $2::int`,
    [paymentId, Number(attemptNumber) || 1, String(status || 'failed'), errorMessage]
  );
  return r.rowCount;
}

export async function getMaxPaymentAttemptNumber(paymentId) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT COALESCE(MAX(attempt_number), 0)::int AS n
     FROM payment_attempts
     WHERE payment_id = $1::uuid`,
    [paymentId]
  );
  return Number(r.rows[0]?.n || 0);
}

export async function getLatestFailedPaymentByUser(email) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.*, u.email
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE lower(u.email) = lower($1)
       AND p.status = 'failed'
     ORDER BY p.updated_at DESC
     LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

/** Pending longer than 30 minutes → failed (abandoned checkout). */
export async function markPendingPaymentExpiredIfStale(email, paymentId) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments p SET status = 'failed', updated_at = NOW()
     FROM users u
     WHERE p.id = $1::uuid AND p.user_id = u.id AND u.email = $2
       AND p.status = 'pending'
       AND p.created_at < NOW() - INTERVAL '30 minutes'
     RETURNING p.id`,
    [paymentId, email]
  );
  if (r.rowCount > 0) {
    console.log('[payment] expired', paymentId, email);
    return true;
  }
  return false;
}

export async function updatePaymentExternalId(paymentId, email, externalId) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments p SET external_id = $3, authority = $3, updated_at = NOW()
     FROM users u WHERE p.id = $1::uuid AND p.user_id = u.id AND u.email = $2
     RETURNING p.id`,
    [paymentId, email, String(externalId).slice(0, 255)]
  );
  return r.rowCount > 0;
}

export async function setPaymentProviderOrderId(paymentId, email, providerOrderId) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments p SET provider_order_id = $3, updated_at = NOW()
     FROM users u WHERE p.id = $1::uuid AND p.user_id = u.id AND u.email = $2
     RETURNING p.id`,
    [paymentId, email, String(providerOrderId).slice(0, 64)]
  );
  return r.rowCount > 0;
}

/** Reset failed payment for YekPay retry with a fresh gateway order id. */
export async function preparePaymentYekpayRetry(email, paymentId, providerOrderId) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments p SET
       status = 'pending',
       provider_order_id = $3,
       external_id = NULL,
       authority = NULL,
       updated_at = NOW()
     FROM users u
     WHERE p.id = $1::uuid AND p.user_id = u.id AND lower(u.email) = lower($2)
       AND p.status = 'failed'
     RETURNING p.id`,
    [paymentId, email, String(providerOrderId).slice(0, 64)]
  );
  return r.rowCount > 0;
}

export async function getPaymentForUserById(paymentId, email) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.* FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1::uuid AND u.email = $2`,
    [paymentId, email]
  );
  return r.rows[0] || null;
}

export async function getPaymentByProviderExternalId(provider, externalId) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.*, u.email
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE lower(p.provider) = lower($1)
       AND p.external_id = $2
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [String(provider || '').slice(0, 64), String(externalId || '').slice(0, 255)]
  );
  return r.rows[0] || null;
}

export async function getPaymentByProviderOrderId(provider, providerOrderId) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.*, u.email
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE lower(p.provider) = lower($1)
       AND p.provider_order_id = $2
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [String(provider || '').slice(0, 64), String(providerOrderId || '').slice(0, 64)]
  );
  return r.rows[0] || null;
}

/**
 * After provider confirms payment: upgrade subscription and mark payment success.
 * Idempotent if already success. Only upgrades from pending.
 */
export async function finalizePendingPaymentSuccess(
  email,
  paymentId,
  planKey,
  stripeCustomerId,
  stripeSubscriptionId,
  currentPeriodEnd
) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT p.id, p.status, p.user_id, p.plan_key FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1::uuid AND u.email = $2 FOR UPDATE`,
      [paymentId, email]
    );
    if (!lock.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'not_found' };
    }
    const row = lock.rows[0];
    if (row.status === 'success') {
      await client.query('COMMIT');
      return { ok: true, idempotent: true };
    }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, error: row.status };
    }
    const fromDb = row.plan_key ? resolvePlanKey(row.plan_key) : '';
    const fromArg = planKey ? resolvePlanKey(planKey) : '';
    const pk =
      fromDb && getPlanDef(fromDb)
        ? fromDb
        : fromArg && getPlanDef(fromArg)
          ? fromArg
          : null;
    if (!pk) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'invalid_plan' };
    }
    const userId = row.user_id;
    await client.query(
      `UPDATE subscriptions SET
        plan = $2,
        status = 'active',
        billing_period = 'monthly',
        stripe_customer_id = COALESCE($3, stripe_customer_id),
        stripe_subscription_id = COALESCE($4, stripe_subscription_id),
        current_period_end = $5,
        updated_at = NOW()
       WHERE user_id = $1`,
      [userId, pk, stripeCustomerId || null, stripeSubscriptionId || null, currentPeriodEnd]
    );
    await client.query(
      `UPDATE payments SET status = 'success', updated_at = NOW() WHERE id = $1::uuid`,
      [paymentId]
    );
    await client.query('COMMIT');
    console.log('[payment] upgraded', paymentId, email, pk);
    return { ok: true, upgraded: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function markPaymentSuccess(paymentId, { refId = null, paidAt = new Date(), amountIrr = null } = {}) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments
     SET status = 'success',
         paid_at = COALESCE($2::timestamptz, NOW()),
         ref_id = COALESCE($3, ref_id),
         amount_irr = COALESCE($4::numeric, amount_irr),
         updated_at = NOW()
     WHERE id = $1::uuid AND status = 'pending'
     RETURNING *`,
    [paymentId, paidAt, refId, amountIrr]
  );
  if (r.rows[0]) return r.rows[0];
  const ex = await pool.query(`SELECT * FROM payments WHERE id = $1::uuid`, [paymentId]);
  return ex.rows[0]?.status === 'success' ? ex.rows[0] : null;
}

export async function markPaymentFailed(paymentId, errorMessage = null) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments
     SET status = 'failed', updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [paymentId]
  );
  if (r.rowCount > 0) {
    const n = await getMaxPaymentAttemptNumber(paymentId);
    if (n > 0) {
      await markPaymentAttemptStatus(paymentId, n, 'failed', errorMessage || null);
    }
  }
  return r.rows[0] || null;
}

export async function upsertSubscriptionFromPayment({ userId, planKey, paymentId, autoRenew = false, durationDays = 30 }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, status, expires_at
       FROM subscriptions
       WHERE user_id = $1::uuid
       FOR UPDATE`,
      [userId]
    );
    const now = new Date();
    const base = existing.rows[0]?.expires_at && new Date(existing.rows[0].expires_at) > now
      ? new Date(existing.rows[0].expires_at)
      : now;
    const nextExpiry = new Date(base);
    nextExpiry.setDate(nextExpiry.getDate() + Number(durationDays || 30));
    if (!existing.rows.length) {
      await client.query(
        `INSERT INTO subscriptions (user_id, plan, status, billing_period, started_at, expires_at, auto_renew, last_payment_id, created_at, updated_at)
         VALUES ($1::uuid, $2, 'active', 'monthly', NOW(), $3::timestamptz, $4::boolean, $5::uuid, NOW(), NOW())`,
        [userId, planKey, nextExpiry, Boolean(autoRenew), paymentId]
      );
      await client.query('COMMIT');
      return { created: true, extended: false, expiresAt: nextExpiry };
    }
    await client.query(
      `UPDATE subscriptions
       SET plan = $2,
           status = 'active',
           started_at = COALESCE(started_at, NOW()),
           expires_at = $3::timestamptz,
           current_period_end = $3::timestamptz,
           auto_renew = $4::boolean,
           last_payment_id = $5::uuid,
           updated_at = NOW()
       WHERE user_id = $1::uuid`,
      [userId, planKey, nextExpiry, Boolean(autoRenew), paymentId]
    );
    await client.query('COMMIT');
    return { created: false, extended: true, expiresAt: nextExpiry };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function createInvoiceForPayment({ userId, paymentId, amount, currency = 'EUR' }) {
  const pool = getPool();
  const serialRow = await pool.query(
    `SELECT COUNT(*)::bigint AS c
     FROM invoices
     WHERE date_trunc('year', issued_at) = date_trunc('year', NOW())`
  );
  const next = Number(serialRow.rows[0]?.c || 0) + 1;
  const year = new Date().getUTCFullYear();
  const invoiceNumber = `CUT-${year}-${String(next).padStart(6, '0')}`;
  const r = await pool.query(
    `INSERT INTO invoices (user_id, payment_id, invoice_number, amount, currency, status, issued_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5, 'paid', NOW())
     RETURNING *`,
    [userId, paymentId, invoiceNumber, Number(amount) || 0, String(currency || 'EUR').slice(0, 8)]
  );
  return r.rows[0] || null;
}

export async function listInvoicesByEmail(email, limit = 100) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT i.*, p.plan_key, p.plan, p.amount_eur, p.amount_irr
     FROM invoices i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN payments p ON p.id = i.payment_id
     WHERE lower(u.email) = lower($1)
     ORDER BY i.issued_at DESC
     LIMIT $2`,
    [email, Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return r.rows;
}

export async function getInvoiceByIdForEmail(invoiceId, email) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT i.*, p.plan_key, p.plan, p.amount_eur, p.amount_irr, u.email
     FROM invoices i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN payments p ON p.id = i.payment_id
     WHERE i.id = $1::uuid
       AND lower(u.email) = lower($2)
     LIMIT 1`,
    [invoiceId, email]
  );
  return r.rows[0] || null;
}

export async function checkExpiringSubscriptions(days = 3) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.id, s.user_id, s.plan, s.expires_at, u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.status = 'active'
       AND s.expires_at IS NOT NULL
       AND s.expires_at <= NOW() + (($1::int || ' days')::interval)
     ORDER BY s.expires_at ASC`,
    [Math.max(1, Number(days) || 3)]
  );
  return r.rows;
}

export async function getAdminPaymentsAnalyticsDb({ startDate = '', endDate = '', plan = 'all', status = 'all', userId = '' } = {}) {
  const pool = getPool();
  const params = [];
  const where = [];
  if (startDate) {
    params.push(startDate);
    where.push(`p.created_at >= $${params.length}::timestamptz`);
  }
  if (endDate) {
    params.push(endDate);
    where.push(`p.created_at <= $${params.length}::timestamptz`);
  }
  if (plan && plan !== 'all') {
    params.push(String(plan).toLowerCase());
    where.push(`LOWER(COALESCE(NULLIF(TRIM(p.plan), ''), p.plan_key, 'free')) = $${params.length}`);
  }
  if (status && status !== 'all') {
    params.push(String(status).toLowerCase());
    where.push(`LOWER(p.status) = $${params.length}`);
  }
  if (userId) {
    params.push(String(userId));
    where.push(`p.user_id = $${params.length}::uuid`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const metrics = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS total_revenue_eur,
      COUNT(*) FILTER (WHERE p.status = 'success')::int AS total_successful,
      COUNT(*) FILTER (WHERE p.status = 'failed')::int AS total_failed,
      COUNT(*)::int AS total_attempts
    FROM payments p
    ${whereSql}`,
    params
  );
  const timeline = await pool.query(
    `SELECT
       to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS day,
       COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue_eur,
       COUNT(*)::int AS payments,
       COUNT(*) FILTER (WHERE p.status = 'success')::int AS success,
       COUNT(*) FILTER (WHERE p.status = 'failed')::int AS failed
     FROM payments p
     ${whereSql}
     GROUP BY 1
     ORDER BY 1 ASC`,
    params
  );
  const rows = await pool.query(
    `SELECT p.id, p.user_id, u.email, COALESCE(NULLIF(TRIM(p.plan), ''), p.plan_key, 'free') AS plan,
            COALESCE(p.amount_eur, p.amount, 0)::numeric AS amount_eur,
            p.status, p.created_at
     FROM payments p
     JOIN users u ON u.id = p.user_id
     ${whereSql}
     ORDER BY p.created_at DESC
     LIMIT 300`,
    params
  );
  const m = metrics.rows[0] || {};
  const totalAttempts = Number(m.total_attempts || 0);
  const totalSuccessful = Number(m.total_successful || 0);
  return {
    metrics: {
      totalRevenueEur: Number(m.total_revenue_eur || 0),
      totalSuccessful,
      totalFailed: Number(m.total_failed || 0),
      conversionRate: totalAttempts > 0 ? (totalSuccessful / totalAttempts) * 100 : 0
    },
    timeline: timeline.rows,
    payments: rows.rows
  };
}

/** Webhook or async path: subscription already upgraded; only flip payment row from pending. */
export async function syncPaymentSuccessByExternalId(provider, externalId) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments SET status = 'success', updated_at = NOW()
     WHERE provider = $1 AND external_id = $2 AND status = 'pending'`,
    [String(provider).slice(0, 64), String(externalId).slice(0, 255)]
  );
  return r.rowCount;
}

export async function markPaymentTerminalStatus(email, paymentId, status) {
  if (!['failed', 'canceled'].includes(status)) return 0;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE payments p SET status = $3, updated_at = NOW()
     FROM users u WHERE p.id = $1::uuid AND p.user_id = u.id AND u.email = $2 AND p.status = 'pending'`,
    [paymentId, email, status]
  );
  return r.rowCount;
}

export async function resolveUserIdForAnalytics(email) {
  if (!email) return null;
  const pool = getPool();
  const r = await pool.query('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase().slice(0, 320)]);
  return r.rows[0]?.id || null;
}

/** Plan + free/paid segment for audit enrichment (subscriptions row). */
export async function getUserPlanForAudit(userId) {
  if (!userId) return { plan: null, userSegment: 'free' };
  const pool = getPool();
  const r = await pool.query(
    `SELECT plan, status FROM subscriptions WHERE user_id = $1::uuid LIMIT 1`,
    [String(userId)]
  );
  const row = r.rows[0];
  const plan = row?.plan != null ? String(row.plan).slice(0, 32) : 'free';
  const status = row?.status != null ? String(row.status) : '';
  const paid = plan !== 'free' && status === 'active';
  return { plan, userSegment: paid ? 'paid' : 'free' };
}

export async function insertAnalyticsEvent({ userId, guestId, event, variant, plan }) {
  const pool = getPool();
  const v = variant === 'B' ? 'B' : 'A';
  const ev = String(event || '').slice(0, 64);
  const pl = plan != null && String(plan).trim() !== '' ? String(plan).slice(0, 32) : null;
  const gid = guestId ? String(guestId).slice(0, 64) : null;
  await pool.query(
    `INSERT INTO analytics_events (user_id, guest_id, event, variant, plan)
     VALUES ($1::uuid, $2, $3, $4, $5)`,
    [userId || null, gid, ev, v, pl]
  );
}

export async function getAdminPricingAbMetricsDb() {
  const pool = getPool();
  const funnel = await pool.query(`
    SELECT variant,
      COUNT(*) FILTER (WHERE event = 'pricing_viewed')::int AS views,
      COUNT(*) FILTER (WHERE event = 'upgrade_clicked')::int AS clicks,
      COUNT(*) FILTER (WHERE event = 'payment_started')::int AS started,
      COUNT(*) FILTER (WHERE event = 'payment_success')::int AS payments,
      COUNT(*) FILTER (WHERE event = 'payment_failed')::int AS failed
    FROM analytics_events
    WHERE variant IN ('A', 'B')
    GROUP BY variant
    ORDER BY variant
  `);
  const byPlan = await pool.query(`
    SELECT variant,
      COALESCE(NULLIF(TRIM(plan), ''), '—') AS plan,
      COUNT(*) FILTER (WHERE event = 'upgrade_clicked')::int AS clicks,
      COUNT(*) FILTER (WHERE event = 'payment_started')::int AS started,
      COUNT(*) FILTER (WHERE event = 'payment_success')::int AS payments
    FROM analytics_events
    WHERE variant IN ('A', 'B')
    GROUP BY variant, COALESCE(NULLIF(TRIM(plan), ''), '—')
    HAVING COUNT(*) FILTER (WHERE event IN ('upgrade_clicked', 'payment_started', 'payment_success')) > 0
    ORDER BY variant, plan
  `);
  const mapFunnel = (rows) =>
    rows.map((r) => {
      const views = Number(r.views) || 0;
      const payments = Number(r.payments) || 0;
      return {
        variant: r.variant,
        views,
        clicks: Number(r.clicks) || 0,
        started: Number(r.started) || 0,
        payments,
        failed: Number(r.failed) || 0,
        conversionPct: views > 0 ? Math.round((payments / views) * 10000) / 100 : null
      };
    });
  const funnelMapped = mapFunnel(funnel.rows);
  const byVariant = Object.fromEntries(funnelMapped.map((x) => [x.variant, x]));
  const funnelByVariant = ['A', 'B'].map(
    (v) =>
      byVariant[v] || {
        variant: v,
        views: 0,
        clicks: 0,
        started: 0,
        payments: 0,
        failed: 0,
        conversionPct: null
      }
  );
  const planRows = byPlan.rows.map((r) => ({
    variant: r.variant,
    plan: r.plan,
    clicks: Number(r.clicks) || 0,
    started: Number(r.started) || 0,
    payments: Number(r.payments) || 0
  }));
  return { funnelByVariant, byPlan: planRows };
}

const LEAD_SOURCES = new Set(['soft_unlock', 'save_action', 'seo_guide']);
const CONVERSION_EMAIL_KINDS = new Set(['lead_ready', 'abandon_pay', 'active_use']);

function normalizeLeadEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, 320);
}

/**
 * Insert lead if email is new. Returns whether a new row was inserted.
 */
export async function insertLeadIfNew(email, source) {
  const em = normalizeLeadEmail(email);
  if (!em || !LEAD_SOURCES.has(String(source || ''))) {
    return { inserted: false, email: em, error: 'invalid' };
  }
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO leads (email, source) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [em, source]
  );
  return { inserted: r.rowCount > 0, email: em };
}

export async function wasConversionEmailSentRecently(email, hours = 24) {
  const em = normalizeLeadEmail(email);
  if (!em) return true;
  const pool = getPool();
  const h = Math.max(1, Math.min(168, Number(hours) || 24));
  const r = await pool.query(
    `SELECT 1 FROM conversion_email_log
     WHERE email = $1 AND created_at > NOW() - (INTERVAL '1 hour' * $2::int)
     LIMIT 1`,
    [em, h]
  );
  return r.rows.length > 0;
}

export async function logConversionEmailSent(email, kind) {
  const em = normalizeLeadEmail(email);
  const k = String(kind || '').slice(0, 32);
  if (!em || !CONVERSION_EMAIL_KINDS.has(k)) return;
  const pool = getPool();
  await pool.query(`INSERT INTO conversion_email_log (email, kind) VALUES ($1, $2)`, [em, k]);
}

/**
 * Users who started checkout 30+ min ago with no later payment_success, still on free plan.
 */
export async function findAbandonedCheckoutCandidates({ limit = 40 } = {}) {
  const pool = getPool();
  const lim = Math.max(1, Math.min(200, Number(limit) || 40));
  const r = await pool.query(
    `WITH last_started AS (
       SELECT user_id, MAX(created_at) AS started_at
       FROM analytics_events
       WHERE event = 'payment_started'
         AND user_id IS NOT NULL
         AND created_at < NOW() - INTERVAL '30 minutes'
         AND created_at > NOW() - INTERVAL '14 days'
       GROUP BY user_id
     )
     SELECT u.email::text AS email, u.id AS user_id, ls.started_at
     FROM last_started ls
     JOIN users u ON u.id = ls.user_id
     JOIN subscriptions s ON s.user_id = u.id AND s.plan = 'free'
     WHERE NOT EXISTS (
       SELECT 1 FROM analytics_events ok
       WHERE ok.user_id = ls.user_id
         AND ok.event = 'payment_success'
         AND ok.created_at > ls.started_at
     )
     LIMIT $1`,
    [lim]
  );
  return r.rows;
}

/**
 * Free-plan users with server retention usage count >= 3.
 */
export async function findActiveFreeUsageNudgeCandidates({ limit = 40 } = {}) {
  const pool = getPool();
  const lim = Math.max(1, Math.min(200, Number(limit) || 40));
  const r = await pool.query(
    `SELECT u.email::text AS email, u.id AS user_id, r.count AS usage_count
     FROM users u
     JOIN subscriptions s ON s.user_id = u.id AND s.plan = 'free'
     JOIN retention_usage_stats r ON r.user_id = u.id AND r.count >= 3
     LIMIT $1`,
    [lim]
  );
  return r.rows;
}

const GROWTH_STRATEGIES = ['HARD', 'SOFT', 'REFERRAL', 'DISCOUNT'];

export async function ensureGrowthStrategyStatsSeeded() {
  if (!isBillingDbConfigured()) return;
  const pool = getPool();
  for (const s of GROWTH_STRATEGIES) {
    await pool.query(
      `INSERT INTO growth_strategy_stats (strategy) VALUES ($1) ON CONFLICT (strategy) DO NOTHING`,
      [s]
    );
  }
}

export async function getGrowthStrategyStatsRows() {
  if (!isBillingDbConfigured()) return [];
  await ensureGrowthStrategyStatsSeeded();
  const pool = getPool();
  const r = await pool.query(
    `SELECT strategy, impressions, conversions, revenue, updated_at
     FROM growth_strategy_stats ORDER BY strategy`
  );
  return r.rows.map((row) => ({
    strategy: row.strategy,
    impressions: Number(row.impressions) || 0,
    conversions: Number(row.conversions) || 0,
    revenue: Number(row.revenue) || 0,
    updated_at: row.updated_at,
  }));
}

export async function trackGrowthStrategyEvent({ strategy, event, value }) {
  if (!isBillingDbConfigured()) return { ok: true, skipped: true };
  const s = String(strategy || '').toUpperCase();
  if (!GROWTH_STRATEGIES.includes(s)) return { ok: false, error: 'invalid_strategy' };
  const ev = String(event || '').toLowerCase();
  await ensureGrowthStrategyStatsSeeded();
  const pool = getPool();
  if (ev === 'impression') {
    await pool.query(
      `UPDATE growth_strategy_stats SET impressions = impressions + 1, updated_at = NOW() WHERE strategy = $1`,
      [s]
    );
  } else if (ev === 'conversion') {
    await pool.query(
      `UPDATE growth_strategy_stats SET conversions = conversions + 1, updated_at = NOW() WHERE strategy = $1`,
      [s]
    );
  } else if (ev === 'revenue') {
    const amt = value != null && Number.isFinite(Number(value)) ? Number(value) : 1;
    await pool.query(
      `UPDATE growth_strategy_stats SET revenue = revenue + $2, updated_at = NOW() WHERE strategy = $1`,
      [s, amt]
    );
  } else {
    return { ok: false, error: 'invalid_event' };
  }
  return { ok: true };
}
