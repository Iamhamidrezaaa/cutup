import { setCORSHeaders } from './cors.js';
import {
  findAbandonedCheckoutCandidates,
  findActiveFreeUsageNudgeCandidates,
  isBillingDbConfigured,
} from './billing-repository.js';
import { sendConversionEmailIfAllowed } from './conversion-notify.js';

function verifyCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = String(req.headers?.authorization || '');
  return auth === `Bearer ${secret}`;
}

export default async function cronConversionEmailsHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!verifyCron(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!isBillingDbConfigured()) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  let abandonSent = 0;
  let activeSent = 0;
  try {
    const abandonRows = await findAbandonedCheckoutCandidates({ limit: 35 });
    for (const row of abandonRows) {
      const r = await sendConversionEmailIfAllowed({ email: row.email, kind: 'abandon_pay' });
      if (r.ok) abandonSent += 1;
    }

    const activeRows = await findActiveFreeUsageNudgeCandidates({ limit: 35 });
    for (const row of activeRows) {
      const r = await sendConversionEmailIfAllowed({ email: row.email, kind: 'active_use' });
      if (r.ok) activeSent += 1;
    }
  } catch (e) {
    console.error('[cron-conversion-emails]', e);
    return res.status(500).json({ ok: false, error: 'cron_failed' });
  }

  return res.status(200).json({ ok: true, abandonSent, activeSent });
}
