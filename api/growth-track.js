/**
 * POST /api/growth/track
 * Body: { strategy: "HARD"|"SOFT"|"REFERRAL"|"DISCOUNT", event: "impression"|"conversion"|"revenue", value?: number }
 */
import { setCORSHeaders } from './cors.js';
import { trackGrowthStrategyEvent } from './billing-repository.js';

const rl = new Map();
function allowRate(key, max, windowMs) {
  const now = Date.now();
  let e = rl.get(key);
  if (!e || now - e.t > windowMs) {
    e = { n: 0, t: now };
  }
  e.n += 1;
  rl.set(key, e);
  return e.n <= max;
}

function clientIp(req) {
  const xf = req.headers?.['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim().slice(0, 45);
  return String(req.socket?.remoteAddress || 'local').slice(0, 45);
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

  if (!allowRate('growth-track:' + clientIp(req), 120, 60_000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  const body = readJsonBody(req);
  try {
    const result = await trackGrowthStrategyEvent({
      strategy: body.strategy,
      event: body.event,
      value: body.value,
    });
    return res.status(200).json(result);
  } catch (e) {
    console.error('[growth-track]', e?.message || e);
    return res.status(200).json({ ok: true, skipped: true });
  }
}
