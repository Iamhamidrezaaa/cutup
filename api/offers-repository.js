import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureOffersSchema } from './offers-bootstrap.js';

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().slice(0, 64);
}

export function normalizePlanName(plan) {
  const p = String(plan || '').trim().toLowerCase();
  if (p === 'advanced') return 'business';
  if (['starter', 'pro', 'business', 'free'].includes(p)) return p;
  return '';
}

function randomSegment(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function generateCouponCode(prefix = 'CUTUP', minLen = 8, maxLen = 12) {
  const pool = getPool();
  const pre = String(prefix || 'CUTUP').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5) || 'CUTUP';
  const targetLen = Math.max(minLen, Math.min(maxLen, 10));
  for (let i = 0; i < 30; i += 1) {
    const rem = Math.max(3, targetLen - pre.length);
    const code = `${pre}${randomSegment(rem)}`.slice(0, maxLen);
    const r = await pool.query(`SELECT 1 FROM offers WHERE lower(code) = lower($1) LIMIT 1`, [code]);
    if (!r.rows.length) return code;
  }
  throw new Error('coupon_generation_failed');
}

function normalizePlans(plans) {
  if (!Array.isArray(plans)) return [];
  return plans
    .map((p) => normalizePlanName(p))
    .filter((p) => ['starter', 'pro', 'business'].includes(p));
}

function computeDiscountAmountEur({ discountType, discountValue, amountEur }) {
  const base = Math.max(0, Number(amountEur) || 0);
  const val = Math.max(0, Number(discountValue) || 0);
  if (base <= 0) return 0;
  if (discountType === 'percentage') {
    return Math.min(base, Number(((base * val) / 100).toFixed(4)));
  }
  if (discountType === 'fixed_eur') {
    return Math.min(base, Number(val.toFixed(4)));
  }
  return 0;
}

function mapOfferRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    applicablePlans: Array.isArray(row.applicable_plans) ? row.applicable_plans : [],
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    currentUses: Number(row.current_uses || 0),
    active: Boolean(row.active),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    campaignType: row.campaign_type || 'global',
    sourcePlan: row.source_plan || null,
    targetPlan: row.target_plan || null
  };
}

export async function createOffer(input, createdBy = null) {
  const pool = getPool();
  const code = normalizeCode(input?.code) || await generateCouponCode(String(input?.targetPlan || input?.campaignType || 'CUTUP').slice(0, 5));
  const title = String(input?.title || '').trim().slice(0, 160);
  const description = String(input?.description || '').trim();
  const discountType = String(input?.discountType || '').trim();
  const discountValue = Number(input?.discountValue || 0);
  const applicablePlans = normalizePlans(input?.applicablePlans);
  const maxUses = input?.maxUses == null || input?.maxUses === '' ? null : Math.max(1, Number(input.maxUses));
  const startsAt = input?.startsAt || null;
  const expiresAt = input?.expiresAt || null;
  const campaignType = String(input?.campaignType || 'global').trim().toLowerCase();
  const sourcePlan = normalizePlanName(input?.sourcePlan) || null;
  const targetPlan = normalizePlanName(input?.targetPlan) || null;
  if (!code || !title || !['percentage', 'fixed_eur'].includes(discountType) || discountValue < 0) {
    throw new Error('invalid_offer_payload');
  }
  const r = await pool.query(
    `INSERT INTO offers (code, title, description, discount_type, discount_value, applicable_plans, max_uses, starts_at, expires_at, created_by, campaign_type, source_plan, target_plan)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12,$13)
     RETURNING *`,
    [code, title, description || null, discountType, discountValue, JSON.stringify(applicablePlans), maxUses, startsAt, expiresAt, createdBy, campaignType, sourcePlan, targetPlan]
  );
  return mapOfferRow(r.rows[0]);
}

export async function updateOffer(offerId, input) {
  const pool = getPool();
  const code = normalizeCode(input?.code);
  const title = String(input?.title || '').trim().slice(0, 160);
  const description = String(input?.description || '').trim();
  const discountType = String(input?.discountType || '').trim();
  const discountValue = Number(input?.discountValue || 0);
  const applicablePlans = normalizePlans(input?.applicablePlans);
  const maxUses = input?.maxUses == null || input?.maxUses === '' ? null : Math.max(1, Number(input.maxUses));
  const startsAt = input?.startsAt || null;
  const expiresAt = input?.expiresAt || null;
  const active = Boolean(input?.active);
  const sourcePlan = normalizePlanName(input?.sourcePlan) || null;
  const targetPlan = normalizePlanName(input?.targetPlan) || null;
  const campaignType = String(input?.campaignType || 'global').trim().toLowerCase();
  const r = await pool.query(
    `UPDATE offers
     SET code = $2,
         title = $3,
         description = $4,
         discount_type = $5,
         discount_value = $6,
         applicable_plans = $7::jsonb,
         max_uses = $8,
         starts_at = $9::timestamptz,
         expires_at = $10::timestamptz,
        active = $11,
        campaign_type = $12,
        source_plan = $13,
        target_plan = $14
     WHERE id = $1::uuid
     RETURNING *`,
    [offerId, code, title, description || null, discountType, discountValue, JSON.stringify(applicablePlans), maxUses, startsAt, expiresAt, active, campaignType, sourcePlan, targetPlan]
  );
  return mapOfferRow(r.rows[0] || null);
}

export async function setOfferActive(offerId, active) {
  const pool = getPool();
  await pool.query(`UPDATE offers SET active = $2 WHERE id = $1::uuid`, [offerId, Boolean(active)]);
}

export async function deleteOffer(offerId) {
  const pool = getPool();
  await pool.query(`DELETE FROM offers WHERE id = $1::uuid`, [offerId]);
}

export async function assignOfferToUserId(offerId, userId) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO user_offers (user_id, offer_id, status)
     VALUES ($1::uuid, $2::uuid, 'active')
     ON CONFLICT (user_id, offer_id)
     DO UPDATE SET status = 'active', assigned_at = NOW(), used_at = NULL`,
    [userId, offerId]
  );
}

export async function assignOfferToEmail(offerId, email) {
  const pool = getPool();
  const r = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [String(email || '').trim()]);
  if (!r.rows[0]) {
    return {
      ok: true,
      mode: 'email',
      email: String(email || '').trim().toLowerCase(),
      matchedUsers: 0,
      insertedAssignments: 0,
      skippedAssignments: 0
    };
  }
  await assignOfferToUserId(offerId, r.rows[0].id);
  return {
    ok: true,
    mode: 'email',
    email: String(email || '').trim().toLowerCase(),
    matchedUsers: 1,
    insertedAssignments: 1,
    skippedAssignments: 0
  };
}

export async function assignOfferToAllUsers(offerId) {
  const pool = getPool();
  const matchedR = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  const matchedUsers = Number(matchedR.rows?.[0]?.c || 0);
  const insertedR = await pool.query(
    `INSERT INTO user_offers (user_id, offer_id, status)
     SELECT u.id, $1::uuid, 'active' FROM users u
     ON CONFLICT (user_id, offer_id)
     DO NOTHING
     RETURNING user_id`,
    [offerId]
  );
  return {
    ok: true,
    mode: 'all',
    matchedUsers,
    insertedAssignments: Number(insertedR.rowCount || 0),
    skippedAssignments: Math.max(0, matchedUsers - Number(insertedR.rowCount || 0))
  };
}

export async function assignOfferToPlanUsers(offerId, plan) {
  const pool = getPool();
  const normalizedPlan = normalizePlanName(plan) || 'free';
  const matchedR = await pool.query(
    `SELECT COUNT(DISTINCT s.user_id)::int AS c
     FROM subscriptions s
     WHERE lower(coalesce(s.plan, 'free')) = $1`,
    [normalizedPlan]
  );
  const matchedUsers = Number(matchedR.rows?.[0]?.c || 0);
  const insertedR = await pool.query(
    `INSERT INTO user_offers (user_id, offer_id, status)
     SELECT s.user_id, $1::uuid, 'active'
     FROM subscriptions s
     WHERE lower(coalesce(s.plan, 'free')) = $2
     ON CONFLICT (user_id, offer_id)
     DO NOTHING
     RETURNING user_id`,
    [offerId, normalizedPlan]
  );
  return {
    ok: true,
    mode: 'plan',
    plan: normalizedPlan,
    matchedUsers,
    insertedAssignments: Number(insertedR.rowCount || 0),
    skippedAssignments: Math.max(0, matchedUsers - Number(insertedR.rowCount || 0))
  };
}

export async function listOffersWithAnalytics() {
  const pool = getPool();
  const offers = await pool.query(
    `SELECT o.*,
       COALESCE(r.redemptions, 0)::int AS redemptions,
       COALESCE(a.assignments, 0)::int AS assignments,
       COALESCE(r.discount_total, 0)::numeric AS discount_total,
       COALESCE(r.original_total, 0)::numeric AS original_total,
       COALESCE(r.final_total, 0)::numeric AS final_total
     FROM offers o
     LEFT JOIN (
       SELECT offer_id, COUNT(*) AS assignments FROM user_offers GROUP BY offer_id
     ) a ON a.offer_id = o.id
     LEFT JOIN (
       SELECT offer_id,
         COUNT(*) AS redemptions,
         SUM(discount_amount_eur) AS discount_total,
         SUM(original_amount_eur) AS original_total,
         SUM(final_amount_eur) AS final_total
       FROM offer_redemptions
       GROUP BY offer_id
     ) r ON r.offer_id = o.id
     ORDER BY o.created_at DESC`
  );
  return offers.rows.map((row) => ({
    ...mapOfferRow(row),
    analytics: {
      assignments: Number(row.assignments || 0),
      redemptions: Number(row.redemptions || 0),
      discountTotalEur: Number(row.discount_total || 0),
      originalTotalEur: Number(row.original_total || 0),
      finalTotalEur: Number(row.final_total || 0),
      conversionRate: Number(row.assignments || 0) > 0 ? (Number(row.redemptions || 0) / Number(row.assignments || 0)) * 100 : 0
    }
  }));
}

export async function getOfferByCode(code) {
  const pool = getPool();
  const r = await pool.query(`SELECT * FROM offers WHERE lower(code) = lower($1) LIMIT 1`, [normalizeCode(code)]);
  return mapOfferRow(r.rows[0] || null);
}

export async function createPlanPromotionCampaign({
  title,
  description = '',
  discountType,
  discountValue,
  sourcePlan,
  targetPlan,
  expiresAt = null,
  createdBy = null
}) {
  const pool = getPool();
  const normalizedSourcePlan = normalizePlanName(sourcePlan);
  const normalizedTargetPlan = normalizePlanName(targetPlan);
  if (!normalizedSourcePlan || !normalizedTargetPlan || normalizedSourcePlan === normalizedTargetPlan) {
    throw new Error('invalid_plan_promotion_plans');
  }
  const users = await pool.query(
    `SELECT DISTINCT s.user_id, u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE lower(coalesce(s.plan, 'free')) = lower($1)`,
    [normalizedSourcePlan]
  );
  const generatedCoupons = [];
  for (const u of users.rows) {
    const code = await generateCouponCode(String(normalizedTargetPlan || 'UP').slice(0, 5).toUpperCase());
    const offer = await createOffer({
      code,
      title: `${title} (${u.email})`,
      description,
      discountType,
      discountValue,
      applicablePlans: [normalizedTargetPlan],
      maxUses: 1,
      expiresAt,
      campaignType: 'plan_promotion',
      sourcePlan: normalizedSourcePlan,
      targetPlan: normalizedTargetPlan
    }, createdBy);
    await assignOfferToUserId(offer.id, u.user_id);
    generatedCoupons.push({
      userId: u.user_id,
      email: u.email,
      offerId: offer.id,
      code: offer.code,
      targetPlan: normalizedTargetPlan
    });
  }
  return {
    matchedUsers: Number(users.rows.length || 0),
    insertedAssignments: generatedCoupons.length,
    skippedAssignments: 0,
    generatedCoupons
  };
}

export async function getActiveOffersForUser(userId) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT o.*, uo.status AS user_offer_status, uo.assigned_at, uo.used_at
     FROM user_offers uo
     JOIN offers o ON o.id = uo.offer_id
     WHERE uo.user_id = $1::uuid
     ORDER BY uo.assigned_at DESC`,
    [userId]
  );
  return r.rows.map((row) => ({
    ...mapOfferRow(row),
    userOfferStatus: row.user_offer_status,
    assignedAt: row.assigned_at,
    usedAt: row.used_at
  }));
}

export async function getOfferAssignmentStats(offerId) {
  const pool = getPool();
  const rowsR = await pool.query(
    `SELECT COUNT(*)::int AS c FROM user_offers WHERE offer_id = $1::uuid`,
    [offerId]
  );
  const sampleR = await pool.query(
    `SELECT user_id, status, assigned_at
     FROM user_offers
     WHERE offer_id = $1::uuid
     ORDER BY assigned_at DESC
     LIMIT 5`,
    [offerId]
  );
  return {
    totalAssignments: Number(rowsR.rows?.[0]?.c || 0),
    samples: sampleR.rows || []
  };
}

export async function getOfferDeliveryDiagnostics(offerId) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, code, active, source_plan, target_plan, expires_at
     FROM offers
     WHERE id = $1::uuid
     LIMIT 1`,
    [offerId]
  );
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    offerId: row.id,
    code: row.code,
    active: Boolean(row.active),
    sourcePlan: row.source_plan || null,
    targetPlan: row.target_plan || null,
    expiresAt: row.expires_at || null
  };
}

/** Production: global + per-offer user_offers row visibility (server logs). */
export async function logUserOffersTableSnapshot(label, meta = {}) {
  if (!isBillingDbConfigured()) return;
  try {
    const pool = getPool();
    const totalR = await pool.query(`SELECT COUNT(*)::int AS c FROM user_offers`);
    const recentR = await pool.query(
      `SELECT user_id::text AS user_id, offer_id::text AS offer_id, status, assigned_at, used_at
       FROM user_offers
       ORDER BY assigned_at DESC NULLS LAST
       LIMIT 10`
    );
    let rowsForOffer = null;
    let countForOffer = null;
    if (meta.offerId) {
      const cR = await pool.query(`SELECT COUNT(*)::int AS c FROM user_offers WHERE offer_id = $1::uuid`, [meta.offerId]);
      countForOffer = Number(cR.rows?.[0]?.c ?? 0);
      const sR = await pool.query(
        `SELECT user_id::text AS user_id, offer_id::text AS offer_id, status, assigned_at, used_at
         FROM user_offers
         WHERE offer_id = $1::uuid
         ORDER BY assigned_at DESC NULLS LAST
         LIMIT 10`,
        [meta.offerId]
      );
      rowsForOffer = sR.rows || [];
    }
    console.log('[offers-distribution][user_offers-snapshot]', {
      label,
      ...meta,
      totalUserOffersRows: totalR.rows?.[0]?.c ?? null,
      recentUserOffers: recentR.rows || [],
      countForOffer,
      rowsForOffer
    });
  } catch (e) {
    console.log('[offers-distribution][user_offers-snapshot]', { label, ...meta, error: e?.message || String(e) });
  }
}

export async function validateOfferForCheckout({ userId, planKey, code, amountEur }) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'billing_unavailable' };
  const schema = await ensureOffersSchema();
  if (!schema.ok) return { ok: false, reason: 'offers_unavailable' };
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid_code' };
    }
    const offerR = await client.query(
      `SELECT * FROM offers WHERE lower(code) = lower($1) LIMIT 1 FOR UPDATE`,
      [normalizedCode]
    );
    const offer = offerR.rows[0];
    if (!offer) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid_or_expired' };
    }
    const now = new Date();
    if (!offer.active) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'inactive' };
    }
    if (offer.starts_at && new Date(offer.starts_at) > now) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_started' };
    }
    if (offer.expires_at && new Date(offer.expires_at) < now) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }
    if (offer.max_uses != null && Number(offer.current_uses || 0) >= Number(offer.max_uses)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'max_uses_reached' };
    }
    const plans = Array.isArray(offer.applicable_plans) ? offer.applicable_plans : [];
    if (plans.length && !plans.includes(String(planKey || '').toLowerCase())) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'plan_not_eligible' };
    }
    const userOfferR = await client.query(
      `SELECT * FROM user_offers WHERE user_id = $1::uuid AND offer_id = $2::uuid LIMIT 1 FOR UPDATE`,
      [userId, offer.id]
    );
    if (userOfferR.rows.length) {
      const userOffer = userOfferR.rows[0];
      if (userOffer.status !== 'active') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'already_used' };
      }
    }
    const redemptionR = await client.query(
      `SELECT id FROM offer_redemptions WHERE user_id = $1::uuid AND offer_id = $2::uuid LIMIT 1`,
      [userId, offer.id]
    );
    if (redemptionR.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already_used' };
    }
    const discountAmountEur = computeDiscountAmountEur({
      discountType: offer.discount_type,
      discountValue: Number(offer.discount_value || 0),
      amountEur
    });
    const originalAmountEur = Math.max(0, Number(amountEur) || 0);
    const finalAmountEur = Math.max(0, Number((originalAmountEur - discountAmountEur).toFixed(4)));
    await client.query('COMMIT');
    return {
      ok: true,
      offer: mapOfferRow(offer),
      originalAmountEur,
      discountAmountEur,
      finalAmountEur
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function redeemOfferAtomic({ userId, offerId, paymentId, originalAmountEur, discountAmountEur, finalAmountEur }) {
  const schema = await ensureOffersSchema();
  if (!schema.ok) return { ok: false, reason: 'offers_unavailable' };
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const offerR = await client.query(`SELECT * FROM offers WHERE id = $1::uuid FOR UPDATE`, [offerId]);
    if (!offerR.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'offer_not_found' };
    }
    const used = await client.query(
      `SELECT id FROM offer_redemptions WHERE user_id = $1::uuid AND offer_id = $2::uuid LIMIT 1 FOR UPDATE`,
      [userId, offerId]
    );
    if (used.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already_redeemed' };
    }
    await client.query(
      `INSERT INTO offer_redemptions (user_id, offer_id, payment_id, original_amount_eur, discount_amount_eur, final_amount_eur)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric)`,
      [userId, offerId, paymentId || null, originalAmountEur, discountAmountEur, finalAmountEur]
    );
    await client.query(
      `UPDATE offers SET current_uses = current_uses + 1 WHERE id = $1::uuid`,
      [offerId]
    );
    await client.query(
      `UPDATE user_offers SET status = 'used', used_at = NOW() WHERE user_id = $1::uuid AND offer_id = $2::uuid`,
      [userId, offerId]
    );
    if (paymentId) {
      await client.query(
        `UPDATE payments
         SET original_amount_eur = $2::numeric,
             discount_amount_eur = $3::numeric,
             final_amount_eur = $4::numeric,
             discount_code = (SELECT code FROM offers WHERE id = $5::uuid),
             applied_offer_id = $5::uuid
         WHERE id = $1::uuid`,
        [paymentId, originalAmountEur, discountAmountEur, finalAmountEur, offerId]
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
