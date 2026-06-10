/**
 * POST /api/pipeline-feedback
 * Minimal thumbs up/down after transcription, translation, or export.
 */
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { insertPipelineFeedback } from './pipeline-feedback-repository.js';
import { notifyAdminsNegativePipelineFeedback } from './pipeline-feedback-notify.js';

const ALLOWED_ACTIONS = new Set(['transcription', 'translation', 'export']);
const ALLOWED_RATINGS = new Set(['up', 'down']);

const rl = new Map();
function allowRate(key, max, windowMs) {
  const now = Date.now();
  let entry = rl.get(key);
  if (!entry || now - entry.t > windowMs) {
    entry = { n: 0, t: now };
  }
  entry.n += 1;
  rl.set(key, entry);
  return entry.n <= max;
}

function clientIp(req) {
  const xf = req.headers?.['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim().slice(0, 64);
  return String(req.socket?.remoteAddress || 'local').slice(0, 64);
}

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
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  if (!allowRate(`pipeline-feedback:${clientIp(req)}`, 40, 60_000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  const body = readJsonBody(req);
  const action = String(body.action || '').trim().toLowerCase();
  const rating = String(body.rating || '').trim().toLowerCase();

  if (!ALLOWED_ACTIONS.has(action) || !ALLOWED_RATINGS.has(rating)) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' });
  }

  const comment = String(body.comment || '').trim().slice(0, 2000);
  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

  const sessionId = String(req.headers['x-session-id'] || body.sessionId || body.session || '').trim();
  let userEmail = null;
  if (sessionId) {
    const sess = sessions.get(sessionId);
    userEmail = sess?.user?.email ? String(sess.user.email).trim().toLowerCase() : null;
  }

  try {
    const result = await insertPipelineFeedback({
      userEmail,
      sessionId: sessionId || null,
      action,
      rating,
      comment: rating === 'down' ? comment || null : null,
      metadata,
      clientIp: clientIp(req)
    });

    console.log('[pipeline-feedback-received]', {
      action,
      rating,
      hasComment: Boolean(comment),
      userEmail: userEmail ? `${userEmail.slice(0, 3)}…` : null,
      stored: result.stored
    });

    if (rating === 'down' && result.feedback) {
      void notifyAdminsNegativePipelineFeedback(result.feedback).catch((notifyErr) => {
        console.warn('[pipeline-feedback-notify-error]', notifyErr?.message || notifyErr);
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[pipeline-feedback-error]', err?.message || err);
    return res.status(200).json({ ok: true, skipped: true });
  }
}
