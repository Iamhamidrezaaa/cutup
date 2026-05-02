/**
 * GET /api/growth/decision?segment=cold|warm|hot&usage=3&intent_score=0.5
 */
import { setCORSHeaders } from './cors.js';
import { getGrowthStrategyStatsRows, isBillingDbConfigured } from './billing-repository.js';

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

const MIN_IMPRESSIONS_TOTAL = 30;

function fallbackDecision(segment, usage, intentScore) {
  const seg = String(segment || 'cold').toLowerCase();
  const u = Math.max(0, Number(usage) || 0);
  const isc = intentScore != null && intentScore !== '' ? Number(intentScore) : null;
  const hasIntent = Number.isFinite(isc);
  if (seg === 'hot' || u >= 5 || (hasIntent && isc >= 0.66)) {
    return { monetization: 'HARD', incentive: 'DISCOUNT', strategy: 'DISCOUNT' };
  }
  if (seg === 'warm' || u >= 2 || (hasIntent && isc >= 0.33)) {
    return { monetization: 'SOFT', incentive: 'REFERRAL', strategy: 'REFERRAL' };
  }
  return { monetization: 'NONE', incentive: 'NONE', strategy: 'NONE' };
}

function mapStrategyToOutput(strategy) {
  switch (String(strategy || '').toUpperCase()) {
    case 'HARD':
      return { monetization: 'HARD', incentive: 'NONE', strategy: 'HARD' };
    case 'DISCOUNT':
      return { monetization: 'HARD', incentive: 'DISCOUNT', strategy: 'DISCOUNT' };
    case 'SOFT':
      return { monetization: 'SOFT', incentive: 'NONE', strategy: 'SOFT' };
    case 'REFERRAL':
      return { monetization: 'SOFT', incentive: 'REFERRAL', strategy: 'REFERRAL' };
    default:
      return { monetization: 'NONE', incentive: 'NONE', strategy: 'NONE' };
  }
}

function computeBestStrategy(rows) {
  const totalImp = rows.reduce((a, r) => a + (r.impressions || 0), 0);
  if (totalImp < MIN_IMPRESSIONS_TOTAL) return null;
  const maxRev = Math.max(...rows.map((r) => Number(r.revenue) || 0), 1e-9);
  let best = null;
  let bestScore = -Infinity;
  for (const r of rows) {
    const imp = r.impressions || 0;
    const conv = imp > 0 ? (r.conversions || 0) / imp : 0;
    const revW = (Number(r.revenue) || 0) / maxRev;
    const score = 0.7 * conv + 0.3 * revW;
    if (score > bestScore) {
      bestScore = score;
      best = r.strategy;
    }
  }
  return best;
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!allowRate('growth-decision:' + clientIp(req), 45, 60_000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const segment = String(req.query?.segment || 'cold').toLowerCase();
  const usage = Number(req.query?.usage) || 0;
  const intentRaw = req.query?.intent_score;
  const intentParsed =
    intentRaw != null && String(intentRaw).trim() !== '' ? Number(intentRaw) : null;

  const fb = fallbackDecision(segment, usage, intentParsed);

  if (!isBillingDbConfigured()) {
    return res.status(200).json({ ...fb, source: 'fallback_no_db' });
  }

  try {
    const rows = await getGrowthStrategyStatsRows();
    const best = computeBestStrategy(rows);
    if (!best) {
      return res.status(200).json({ ...fb, source: 'fallback_low_data' });
    }
    const out = mapStrategyToOutput(best);
    return res.status(200).json({ ...out, source: 'brain' });
  } catch (e) {
    console.error('[growth-decision]', e?.message || e);
    return res.status(200).json({ ...fb, source: 'fallback_error' });
  }
}
