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

/** Admin Customers: editable plans (must match UI dropdown). */
const ADMIN_CUSTOMER_PLAN_KEYS = new Set(['free', 'starter', 'pro', 'business', 'advanced']);

function planLabelForAdmin(planKey) {
  const k = planKey && String(planKey).toLowerCase();
  if (!k) return 'Free';
  const def = PLANS[k];
  if (def?.name) return def.name;
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function subscriptionPriceLabel(planKey) {
  const k = planKey && String(planKey).toLowerCase();
  if (!k || !PLANS[k]) return '—';
  const eur = PLANS[k].priceEur?.monthly;
  if (eur == null || Number(eur) === 0) return '€0';
  const n = Number(eur);
  return `€${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export async function getAdminUsersDb({ search = '', plan = 'all', limit = 200 } = {}) {
  const pool = getPool();
  const filters = [];
  const params = [];
  filters.push(`NOT EXISTS (SELECT 1 FROM admins a WHERE lower(a.email) = lower(u.email))`);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    filters.push(
      `(LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.display_name, '')) LIKE $${params.length})`
    );
  }
  if (plan && plan !== 'all') {
    params.push(plan);
    filters.push(`COALESCE(s.plan, 'free') = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT
       u.id AS user_id,
       u.email,
       u.display_name,
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
  return r.rows.map((row) => {
    const hasSubscriptionRow = Boolean(row.subscription_id);
    const subPlan = hasSubscriptionRow
      ? String(row.subscription_plan || 'free').toLowerCase().trim() || 'free'
      : null;
    const effectivePlan = hasSubscriptionRow ? subPlan : 'free';
    const uiStatus =
      String(row.subscription_status || 'active').toLowerCase() === 'canceled' ? 'inactive' : 'active';
    const dn = row.display_name != null && String(row.display_name).trim() !== '' ? String(row.display_name).trim() : '';
    return {
      id: row.user_id,
      email: row.email,
      name: dn || row.email.split('@')[0],
      plan: effectivePlan,
      planLabel: planLabelForAdmin(effectivePlan),
      status: hasSubscriptionRow ? uiStatus : 'active',
      subscription: hasSubscriptionRow
        ? {
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
          }
        : null,
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
  });
}

/**
 * Update customer profile + subscription (panel users only; blocked for rows that match admins email).
 */
export async function adminPatchCustomerUser(userId, { name, plan, status } = {}) {
  const pool = getPool();
  const uid = String(userId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)) {
    return { ok: false, error: 'invalid_id' };
  }
  const uRes = await pool.query('SELECT id, email FROM users WHERE id = $1::uuid', [uid]);
  if (!uRes.rows[0]) return { ok: false, error: 'not_found' };
  const email = uRes.rows[0].email;
  const adm = await pool.query('SELECT 1 FROM admins WHERE lower(email) = lower($1)', [email]);
  if (adm.rows.length) return { ok: false, error: 'cannot_edit_admin' };

  const nameStr = name !== undefined ? String(name).trim().slice(0, 255) : undefined;
  const planStr = plan !== undefined ? String(plan).trim().toLowerCase() : undefined;
  const statusStr = status !== undefined ? String(status).trim().toLowerCase() : undefined;

  if (planStr !== undefined && !ADMIN_CUSTOMER_PLAN_KEYS.has(planStr)) {
    return { ok: false, error: 'invalid_plan' };
  }
  if (statusStr !== undefined && !['active', 'inactive'].includes(statusStr)) {
    return { ok: false, error: 'invalid_status' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (nameStr !== undefined) {
      await client.query('UPDATE users SET display_name = $2 WHERE id = $1::uuid', [
        uid,
        nameStr === '' ? null : nameStr
      ]);
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
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function adminDeleteCustomerUser(userId) {
  const pool = getPool();
  const uid = String(userId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)) {
    return { ok: false, error: 'invalid_id' };
  }
  const uRes = await pool.query('SELECT id, email FROM users WHERE id = $1::uuid', [uid]);
  if (!uRes.rows[0]) return { ok: false, error: 'not_found' };
  const adm = await pool.query('SELECT 1 FROM admins WHERE lower(email) = lower($1)', [uRes.rows[0].email]);
  if (adm.rows.length) return { ok: false, error: 'cannot_delete_admin' };
  await pool.query('DELETE FROM users WHERE id = $1::uuid', [uid]);
  return { ok: true };
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
  const normalizedStatus = status === 'published' ? 'published' : 'draft';
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
export async function insertPaymentPending({ email, provider, amount, currency, externalId, planKey, discountCode }) {
  const userId = await ensureUserByEmail(email);
  const pool = getPool();
  const pk = planKey && PLANS[planKey] ? String(planKey).slice(0, 32) : null;
  const dc = discountCode ? String(discountCode).slice(0, 32) : null;
  const r = await pool.query(
    `INSERT INTO payments (user_id, provider, status, amount, currency, external_id, plan_key, discount_code)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      userId,
      String(provider || 'stripe').slice(0, 64),
      amount != null ? Number(amount) : null,
      String(currency || 'EUR').slice(0, 8),
      externalId ? String(externalId).slice(0, 255) : null,
      pk,
      dc
    ]
  );
  return r.rows[0].id;
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
    `UPDATE payments p SET external_id = $3, updated_at = NOW()
     FROM users u WHERE p.id = $1::uuid AND p.user_id = u.id AND u.email = $2
     RETURNING p.id`,
    [paymentId, email, String(externalId).slice(0, 255)]
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
    const fromDb = row.plan_key ? String(row.plan_key).toLowerCase() : '';
    const fromArg = planKey ? String(planKey).toLowerCase() : '';
    const pk =
      fromDb && PLANS[fromDb]
        ? fromDb
        : fromArg && PLANS[fromArg]
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
