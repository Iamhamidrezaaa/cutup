import { setCORSHeaders } from './cors.js';
import { refreshEurIrrRateDaily } from './eur-irr-rate.js';

function verifyCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = String(req.headers?.authorization || '');
  return auth === `Bearer ${secret}`;
}

/** Vercel Cron: daily 08:30 UTC = 12:00 Iran (Asia/Tehran). */
export default async function cronEurIrrRateHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!verifyCron(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const result = await refreshEurIrrRateDaily();
    if (!result.ok) {
      console.error('[cron-eur-irr]', result);
      return res.status(502).json({ ok: false, error: result.error || 'refresh_failed', detail: result });
    }
    return res.status(200).json({
      ok: true,
      rate: result.rate ?? null,
      source: result.source ?? null,
      skipped: Boolean(result.skipped),
      reason: result.reason || null
    });
  } catch (e) {
    console.error('[cron-eur-irr]', e);
    return res.status(500).json({ ok: false, error: 'cron_failed' });
  }
}
