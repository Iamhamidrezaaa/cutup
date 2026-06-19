import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import {
  assignOfferToAllUsers,
  assignOfferToEmail,
  assignOfferToPlanUsers,
  createOffer,
  deleteOffer,
  listOffersWithAnalytics,
  setOfferActive,
  updateOffer,
  createPlanPromotionCampaign,
  getOfferByCode,
  getOfferAssignmentStats,
  getOfferDeliveryDiagnostics,
  logUserOffersTableSnapshot,
  normalizePlanName
} from './offers-repository.js';
import { isEmailTransportConfigured } from './email.js';
import { sendTemplatedEmail } from './email-events-bus.js';
import { ensureOffersSchema } from './offers-bootstrap.js';
import {
  buildOfferCheckoutUrl,
  formatDiscountLabel,
  formatExpiresLabel,
  formatPlanLabel,
  getPlanUpgradeHighlights,
  inferFirstNameFromEmail,
} from './offer-email-content.js';
import { getPool } from './db/pool.js';

const offerJobs = new Map();

function enqueueOfferJob(jobName, runner) {
  const jobId = `offer_job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  offerJobs.set(jobId, {
    id: jobId,
    name: jobName,
    status: 'queued',
    createdAt: new Date().toISOString(),
    doneAt: null,
    error: null,
    result: null
  });
  setTimeout(async () => {
    const row = offerJobs.get(jobId);
    if (!row) return;
    row.status = 'running';
    try {
      const result = await runner();
      row.status = 'completed';
      row.doneAt = new Date().toISOString();
      row.result = result || null;
    } catch (e) {
      row.status = 'failed';
      row.doneAt = new Date().toISOString();
      row.error = e?.message || String(e);
    }
  }, 0);
  return jobId;
}

async function lookupOfferRecipientProfile(email) {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT first_name, email FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [String(email || '').trim()]
    );
    const row = r.rows?.[0];
    if (!row) {
      return { firstName: inferFirstNameFromEmail(email), email: String(email || '').trim().toLowerCase() };
    }
    const firstName = String(row.first_name || '').trim() || inferFirstNameFromEmail(row.email || email);
    return { firstName, email: String(row.email || email).trim().toLowerCase() };
  } catch (_e) {
    return { firstName: inferFirstNameFromEmail(email), email: String(email || '').trim().toLowerCase() };
  }
}

async function sendOfferEmailAsync({
  email,
  code,
  title,
  sourcePlan,
  targetPlan,
  discountType,
  discountValue,
  expiresAt,
}) {
  const normalizedTargetPlan = normalizePlanName(targetPlan) || 'pro';
  const normalizedSourcePlan = normalizePlanName(sourcePlan) || 'free';
  const profile = await lookupOfferRecipientProfile(email);
  const discountLabel = formatDiscountLabel(discountType, discountValue);
  const checkoutUrl = buildOfferCheckoutUrl({ plan: normalizedTargetPlan, coupon: code, source: 'offer_email' });
  const templateData = {
    firstName: profile.firstName,
    email: profile.email,
    campaignTitle: title || 'Special upgrade offer',
    sourcePlanName: formatPlanLabel(normalizedSourcePlan),
    targetPlanName: formatPlanLabel(normalizedTargetPlan),
    discountLabel,
    couponCode: String(code || '').trim().toUpperCase(),
    expiresLabel: formatExpiresLabel(expiresAt),
    checkoutUrl,
    upgradeHighlights: getPlanUpgradeHighlights(normalizedSourcePlan, normalizedTargetPlan),
  };

  const out = await sendTemplatedEmail({
    template: 'OFFER_PROMOTION',
    recipient: profile.email,
    data: templateData,
    senderRole: 'billing',
    tags: ['offer', 'promotion'],
  });

  console.log('[offers-distribution][email]', {
    email: profile.email,
    offerCode: code,
    sourcePlan: normalizedSourcePlan,
    targetPlan: normalizedTargetPlan,
    checkoutUrl,
    status: out?.sent ? 'sent' : (out?.skipped ? 'skipped' : 'failed'),
    error: out?.error || out?.reason || null,
    template: 'OFFER_PROMOTION',
  });
  return out;
}

export default async function handler(req, res) {
  try {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    const auth = await resolveAdminAuth(req);
    if (!auth) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const schema = await ensureOffersSchema();
    if (!schema.ok) {
      if (req.method === 'GET') return res.status(200).json({ ok: true, offers: [], degraded: true });
      return res.status(503).json({ ok: false, error: 'offers_unavailable', degraded: true });
    }

    if (req.method === 'GET') {
      if (String(req.query?.action || '').trim() === 'job' && req.query?.jobId) {
        const row = offerJobs.get(String(req.query.jobId).trim());
        if (!row) return res.status(404).json({ ok: false, error: 'job_not_found' });
        return res.status(200).json({ ok: true, job: row });
      }
      const offers = await listOffersWithAnalytics();
      return res.status(200).json({ ok: true, offers });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const action = String(body.action || '').trim();
      if (action === 'create') {
        const offer = await createOffer(body, auth.email);
        return res.status(200).json({ ok: true, offerId: offer.id, offer });
      }
    if (action === 'update') {
      const offer = await updateOffer(body.offerId, body);
      return res.status(200).json({ ok: true, offer });
    }
    if (action === 'disable') {
      await setOfferActive(body.offerId, false);
      return res.status(200).json({ ok: true });
    }
    if (action === 'enable') {
      await setOfferActive(body.offerId, true);
      return res.status(200).json({ ok: true });
    }
    if (action === 'delete') {
      await deleteOffer(body.offerId);
      return res.status(200).json({ ok: true });
    }
    if (action === 'assign_email') {
      const result = await assignOfferToEmail(body.offerId, body.email);
      const assignmentStats = await getOfferAssignmentStats(body.offerId);
      const diagnostics = await getOfferDeliveryDiagnostics(body.offerId);
      console.log('[offers-distribution]', { offerId: body.offerId, ...result, assignmentStats, diagnostics, errors: null });
      await logUserOffersTableSnapshot('assign_email', { offerId: body.offerId });
      return res.status(200).json({ ok: true, distribution: result, assignmentStats, diagnostics });
    }
    if (action === 'assign_all') {
      const result = await assignOfferToAllUsers(body.offerId, {
        excludeAlreadyAssigned: body.excludeAlreadyAssigned !== false
      });
      const assignmentStats = await getOfferAssignmentStats(body.offerId);
      const diagnostics = await getOfferDeliveryDiagnostics(body.offerId);
      console.log('[offers-distribution]', { offerId: body.offerId, ...result, assignmentStats, diagnostics, errors: null });
      await logUserOffersTableSnapshot('assign_all', { offerId: body.offerId });
      return res.status(200).json({ ok: true, distribution: result, assignmentStats, diagnostics });
    }
    if (action === 'assign_plan') {
      const result = await assignOfferToPlanUsers(body.offerId, body.plan, {
        excludeAlreadyAssigned: body.excludeAlreadyAssigned !== false
      });
      const assignmentStats = await getOfferAssignmentStats(body.offerId);
      const diagnostics = await getOfferDeliveryDiagnostics(body.offerId);
      console.log('[offers-distribution]', { offerId: body.offerId, ...result, assignmentStats, diagnostics, errors: null });
      await logUserOffersTableSnapshot('assign_plan', { offerId: body.offerId, plan: normalizePlanName(body.plan) });
      return res.status(200).json({ ok: true, distribution: result, assignmentStats, diagnostics });
    }
    if (action === 'create_plan_promotion') {
      const jobId = enqueueOfferJob('create_plan_promotion', async () => {
        const distribution = await createPlanPromotionCampaign({
          title: String(body.title || '').trim() || 'Plan upgrade offer',
          description: String(body.description || '').trim(),
          discountType: String(body.discountType || 'percentage'),
          discountValue: Number(body.discountValue || 0),
          sourcePlan: normalizePlanName(body.sourcePlan),
          targetPlan: normalizePlanName(body.targetPlan),
          expiresAt: body.expiresAt || null,
          createdBy: auth.email
        });
        const emailStats = {
          attempted: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
          failures: []
        };
        for (const entry of (distribution.generatedCoupons || [])) {
          emailStats.attempted += 1;
          const out = await sendOfferEmailAsync({
            email: entry.email,
            code: entry.code,
            title: body.title,
            sourcePlan: normalizePlanName(body.sourcePlan),
            targetPlan: entry.targetPlan,
            discountType: String(body.discountType || 'percentage'),
            discountValue: Number(body.discountValue || 0),
            expiresAt: body.expiresAt || null
          });
          if (out?.sent) emailStats.sent += 1;
          else if (out?.skipped) emailStats.skipped += 1;
          else {
            emailStats.failed += 1;
            emailStats.failures.push({
              email: entry.email,
              error: out?.error || 'send_failed'
            });
          }
        }
        console.log('[offers-distribution]', {
          offerId: null,
          mode: 'create_plan_promotion',
          matchedUsers: distribution.matchedUsers,
          insertedAssignments: distribution.insertedAssignments,
          skippedAssignments: distribution.skippedAssignments,
          errors: emailStats.failures
        });
        await logUserOffersTableSnapshot('create_plan_promotion', {
          matchedUsers: distribution.matchedUsers,
          insertedAssignments: distribution.insertedAssignments
        });
        return {
          matchedUsers: distribution.matchedUsers,
          insertedAssignments: distribution.insertedAssignments,
          skippedAssignments: distribution.skippedAssignments,
          generatedCoupons: (distribution.generatedCoupons || []).length,
          email: emailStats,
          emailConfigured: isEmailTransportConfigured()
        };
      });
      return res.status(200).json({
        ok: true,
        jobId,
        message: 'Campaign accepted and running in background.'
      });
    }
    if (action === 'send_offer_email') {
      const code = String(body.code || '').trim().toUpperCase();
      const email = String(body.email || '').trim();
      const offer = await getOfferByCode(code);
      if (!offer) return res.status(404).json({ ok: false, error: 'offer_not_found' });
      const jobId = enqueueOfferJob('send_offer_email', async () => {
        const out = await sendOfferEmailAsync({
          email,
          code: offer.code,
          title: offer.title,
          sourcePlan: offer.sourcePlan || 'free',
          targetPlan: offer.targetPlan || offer.applicablePlans?.[0] || 'pro',
          discountType: offer.discountType,
          discountValue: offer.discountValue,
          expiresAt: offer.expiresAt
        });
        return {
          sent: !!out?.sent,
          skipped: !!out?.skipped,
          failed: !out?.sent && !out?.skipped,
          error: out?.error || null,
          emailConfigured: isEmailTransportConfigured()
        };
      });
      return res.status(200).json({ ok: true, jobId });
    }
      return res.status(400).json({ ok: false, error: 'invalid_action' });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'offers_handler_failed' });
  }
}
