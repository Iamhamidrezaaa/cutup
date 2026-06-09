import { setCORSHeaders } from './cors.js';
import { isBillingDbConfigured } from './billing-repository.js';
import { processAllExpiredSubscriptions } from './billing-payable-invoices.js';

function verifyCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = String(req.headers?.authorization || '');
  return auth === `Bearer ${secret}`;
}

export default async function cronSubscriptionExpiryHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!verifyCron(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!isBillingDbConfigured()) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const results = await processAllExpiredSubscriptions({ limit: 80 });
    const processed = results.filter((r) => r.ok).length;
    return res.status(200).json({ ok: true, processed, total: results.length, results });
  } catch (e) {
    console.error('[cron-subscription-expiry]', e);
    return res.status(500).json({ ok: false, error: 'cron_failed' });
  }
}
