import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import {
  isBillingDbConfigured,
  insertAnalyticsEvent,
  resolveUserIdForAnalytics
} from './billing-repository.js';

const ALLOWED_EVENTS = new Set([
  'pricing_viewed',
  'upgrade_clicked',
  'payment_started',
  'payment_success',
  'payment_failed',
  'offer_shown',
  'offer_clicked',
  'discount_used',
  'email_sent',
  'email_clicked',
  'referral_signup',
]);

function readJsonBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString('utf8'));
    } catch {
      body = {};
    }
  }
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body && typeof body === 'object' ? body : {};
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = readJsonBody(req);
  const event = String(body?.event || '').trim();
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ ok: false });
  }

  let variant = String(body?.variant ?? 'A').toUpperCase();
  if (variant !== 'A' && variant !== 'B') variant = 'A';

  const refSignup =
    event === 'referral_signup' && body?.referrer != null && String(body.referrer).trim() !== ''
      ? body.referrer
      : null;
  const planRaw = refSignup != null ? refSignup : body?.plan;
  const plan =
    planRaw != null && String(planRaw).trim() !== '' ? String(planRaw).trim().slice(0, 32) : null;

  const guestId = body?.guest_id ? String(body.guest_id).slice(0, 64) : null;

  const sessionId = req.headers['x-session-id'] || body?.session_id || body?.sessionId;
  let userId = null;
  if (sessionId) {
    const sess = sessions.get(String(sessionId));
    if (sess?.user?.email) {
      try {
        userId = await resolveUserIdForAnalytics(sess.user.email);
      } catch {
        userId = null;
      }
    }
  }

  if (!isBillingDbConfigured()) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    await insertAnalyticsEvent({ userId, guestId, event, variant, plan });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[analytics] insert failed', e.message);
    }
  }

  return res.status(200).json({ ok: true });
}
