import { setCORSHeaders } from './cors.js';
import { isBillingDbConfigured, insertLeadIfNew } from './billing-repository.js';
import { sendConversionEmailIfAllowed } from './conversion-notify.js';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function leadsHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = readJsonBody(req);
  const email = String(body?.email || '').trim().toLowerCase();
  const source = String(body?.source || '').trim();

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  if (source !== 'soft_unlock' && source !== 'save_action') {
    return res.status(400).json({ ok: false, error: 'invalid_source' });
  }

  if (!isBillingDbConfigured()) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const { inserted, email: em } = await insertLeadIfNew(email, source);
    if (inserted) {
      await sendConversionEmailIfAllowed({ email: em, kind: 'lead_ready' });
    }
    return res.status(200).json({ ok: true, created: inserted });
  } catch (e) {
    console.error('[leads]', e.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
