import { getPool, isBillingDbConfigured } from './db/pool.js';
import { PLANS } from './plans-config.js';

const UNLIMITED_EMAIL = 'h.asgarizade@gmail.com';

export { isBillingDbConfigured };

function monthKeyUtc() {
  return new Date().toISOString().slice(0, 7);
}

function dayUtc() {
  return new Date().toISOString().slice(0, 10);
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
    let r = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    let userId;
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
    const planKey = sub?.plan || 'free';
    const plan = PLANS[planKey];
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
      const dAmt = Math.min(delta, MAX_MINUTE_DELTA);
      if (planKey === 'free') {
        if (u.dailyMinutes + dAmt > plan.dailyLimit) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            reason: `Daily limit reached (${plan.dailyLimit} minutes). Try again tomorrow or upgrade.`
          };
        }
        if (u.monthlyMinutes + dAmt > plan.monthlyLimit) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            reason: `Monthly limit reached (${plan.monthlyLimit} minutes). Upgrade for more processing time.`
          };
        }
      } else {
        if (u.monthlyMinutes + dAmt > plan.monthlyLimit) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            reason: `Monthly limit reached (${plan.monthlyLimit} minutes). Upgrade or wait for renewal.`
          };
        }
      }

      const newMonthly = u.monthlyMinutes + dAmt;
      const newDaily = u.dailyMinutes + dAmt;
      await client.query(
        `UPDATE usage SET minutes_used = $2, daily_minutes_used = $3, last_reset_at = NOW() WHERE user_id = $1`,
        [userId, newMonthly, newDaily]
      );
      await client.query(
        `INSERT INTO usage_history (user_id, type, minutes, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [userId, usageType, dAmt, JSON.stringify(metadata || {})]
      );
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
    const planKey = sub?.plan || 'free';
    const plan = PLANS[planKey];
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
    metadata = {}
  } = payload;

  if (!email || !type || !content) return null;
  await ensureUserByEmail(email);
  const pool = getPool();
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!userRes.rows.length) return null;
  const userId = userRes.rows[0].id;

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

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await pool.query(
      `UPDATE saved_outputs
       SET platform = $2,
           language = $3,
           content = $4,
           metadata = $5::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [id, platform, language, content, JSON.stringify(metadata || {})]
    );
    return String(id);
  }

  const inserted = await pool.query(
    `INSERT INTO saved_outputs
      (user_id, type, title, platform, source_url, language, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [userId, type, title, platform, sourceUrl, language, content, JSON.stringify(metadata || {})]
  );
  return String(inserted.rows[0].id);
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

export async function getAdminUsersDb({ search = '', plan = 'all', limit = 200 } = {}) {
  const pool = getPool();
  const filters = [];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    filters.push(`(LOWER(u.email) LIKE $${params.length})`);
  }
  if (plan && plan !== 'all') {
    params.push(plan);
    filters.push(`COALESCE(s.plan, 'free') = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT
       u.email,
       COALESCE(s.plan, 'free') AS plan,
       COALESCE(s.status, 'active') AS status,
       u.created_at,
       us.minutes_used,
       COALESCE(so.saved_count, 0)::int AS saved_outputs_count,
       last_h.created_at AS last_activity_at
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN usage us ON us.user_id = u.id
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS saved_count FROM saved_outputs GROUP BY user_id
     ) so ON so.user_id = u.id
     LEFT JOIN (
       SELECT user_id, MAX(created_at) AS created_at FROM usage_history GROUP BY user_id
     ) last_h ON last_h.user_id = u.id
     ${whereSql}
     ORDER BY u.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return r.rows.map((row) => ({
    email: row.email,
    name: row.email.split('@')[0],
    plan: row.plan,
    status: row.status,
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    lastActivityAt: row.last_activity_at?.toISOString ? row.last_activity_at.toISOString() : row.last_activity_at,
    usageMinutesThisMonth: Number(row.minutes_used || 0),
    savedOutputsCount: Number(row.saved_outputs_count || 0)
  }));
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
  return r.rows.map((row) => ({
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
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at?.toISOString ? row.updated_at.toISOString() : row.updated_at,
    publishedAt: row.published_at?.toISOString ? row.published_at.toISOString() : row.published_at
  }));
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
  const normalizedStatus = status === 'published' ? 'published' : 'draft';
  const cleanTags = Array.isArray(tags)
    ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30)
    : [];
  if (id) {
    console.log('[blog] update post', { id, slug, status: normalizedStatus, hasCover: Boolean(coverImageUrl) });
    try {
      const updated = await pool.query(
        `UPDATE blog_posts
         SET slug = $2,
             title = $3,
             cover_image_url = $4,
             excerpt = $5,
             content = $6,
             status = $7,
             category = $8,
             tags = $9::text[],
             meta_title = $10,
             meta_description = $11,
             canonical_url = $12,
             og_title = $13,
             og_description = $14,
             updated_at = NOW(),
             published_at = CASE WHEN $7 = 'published' AND published_at IS NULL THEN NOW() WHEN $7 = 'draft' THEN NULL ELSE published_at END
         WHERE id = $1::bigint
         RETURNING id`,
        [id, slug, title, coverImageUrl, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription]
      );
      return String(updated.rows[0].id);
    } catch (err) {
      // Backward-compatible fallback when DB migration for cover_image_url is not applied yet.
      if (!String(err?.message || '').toLowerCase().includes('cover_image_url')) throw err;
      console.warn('[blog] cover_image_url missing, retrying update without cover column');
      const updated = await pool.query(
        `UPDATE blog_posts
         SET slug = $2,
             title = $3,
             excerpt = $4,
             content = $5,
             status = $6,
             category = $7,
             tags = $8::text[],
             meta_title = $9,
             meta_description = $10,
             canonical_url = $11,
             og_title = $12,
             og_description = $13,
             updated_at = NOW(),
             published_at = CASE WHEN $6 = 'published' AND published_at IS NULL THEN NOW() WHEN $6 = 'draft' THEN NULL ELSE published_at END
         WHERE id = $1::bigint
         RETURNING id`,
        [id, slug, title, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription]
      );
      return String(updated.rows[0].id);
    }
  }
  console.log('[blog] insert post', { slug, status: normalizedStatus, hasCover: Boolean(coverImageUrl) });
  try {
    const inserted = await pool.query(
      `INSERT INTO blog_posts
        (slug, title, cover_image_url, excerpt, content, status, category, tags, meta_title, meta_description, canonical_url, og_title, og_description, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12,$13, CASE WHEN $6 = 'published' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [slug, title, coverImageUrl, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription]
    );
    return String(inserted.rows[0].id);
  } catch (err) {
    if (!String(err?.message || '').toLowerCase().includes('cover_image_url')) throw err;
    console.warn('[blog] cover_image_url missing, retrying insert without cover column');
    const inserted = await pool.query(
      `INSERT INTO blog_posts
        (slug, title, excerpt, content, status, category, tags, meta_title, meta_description, canonical_url, og_title, og_description, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12, CASE WHEN $5 = 'published' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [slug, title, excerpt, content, normalizedStatus, category, cleanTags, metaTitle, metaDescription, canonicalUrl, ogTitle, ogDescription]
    );
    return String(inserted.rows[0].id);
  }
}

export async function publishAdminBlogPostDb(id, publish = true) {
  const pool = getPool();
  const r = await pool.query(
    `UPDATE blog_posts
     SET status = $2,
         updated_at = NOW(),
         published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, NOW()) ELSE NULL END
     WHERE id = $1::bigint
     RETURNING id`,
    [id, publish ? 'published' : 'draft']
  );
  return r.rows.length > 0;
}

export async function canUseFeatureDb(email, feature, videoDurationMinutes = 0) {
  if (email === UNLIMITED_EMAIL) {
    return { allowed: true };
  }

  await ensureUserByEmail(email);
  const sub = await getSubscriptionRowByEmail(email);
  const planKey = sub?.plan || 'free';
  const plan = PLANS[planKey];
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
  }

  if (planKey === 'free') {
    if (usage.dailyMinutes + videoDurationMinutes > plan.dailyLimit) {
      return {
        allowed: false,
        reason: `Daily limit reached (${plan.dailyLimit} minutes). Try again tomorrow or upgrade.`
      };
    }
    if (usage.monthlyMinutes + videoDurationMinutes > plan.monthlyLimit) {
      return {
        allowed: false,
        reason: `Monthly limit reached (${plan.monthlyLimit} minutes). Upgrade for more processing time.`
      };
    }
  } else {
    if (usage.monthlyMinutes + videoDurationMinutes > plan.monthlyLimit) {
      return {
        allowed: false,
        reason: `Monthly limit reached (${plan.monthlyLimit} minutes). Upgrade or wait for renewal.`
      };
    }
  }

  return { allowed: true };
}
