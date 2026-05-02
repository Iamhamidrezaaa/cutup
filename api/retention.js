/**
 * POST /api/retention — hybrid retention sync (recent URLs + usage counter).
 * Guests send guestId; logged-in users resolved via X-Session-Id → users.id.
 */
import { handleCORS } from './cors.js';
import { sessions } from './auth.js';
import {
  isBillingDbConfigured,
  getUserIdByEmail,
  retentionInsertRecent,
  retentionIncrementUsage,
  mergeRetentionGuestToUser,
} from './billing-repository.js';

function sessionEmailFromReq(req) {
  const sid = req.headers['x-session-id'] || req.body?.session;
  if (!sid) return null;
  const s = sessions.get(sid);
  const em = s?.user?.email;
  return em ? String(em).trim().toLowerCase() : null;
}

function validGuestKey(k) {
  if (k == null || typeof k !== 'string') return false;
  return /^[a-zA-Z0-9._-]{8,80}$/.test(k.trim());
}

function validHttpUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const x = new URL(u.trim());
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const corsEarly = handleCORS(req, res);
  if (corsEarly) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isBillingDbConfigured()) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const body = req.body || {};
  const type = body.type;
  const timestamp = Number(body.timestamp) || Date.now();

  try {
    if (type === 'merge') {
      const guestId = String(body.guestId || body.guest_key || '').trim();
      if (!validGuestKey(guestId)) {
        return res.status(400).json({ ok: false, error: 'invalid_guest' });
      }
      const email = sessionEmailFromReq(req);
      if (!email) {
        return res.status(401).json({ ok: false, error: 'auth_required' });
      }
      const out = await mergeRetentionGuestToUser(guestId, email);
      return res.status(200).json({ ok: true, merged: !!out.merged });
    }

    const email = sessionEmailFromReq(req);
    const userId = email ? await getUserIdByEmail(email) : null;
    const guestRaw = String(body.guestId || body.guest_key || '').trim();
    const guestKey = userId ? null : guestRaw;

    if (!userId && !validGuestKey(guestKey)) {
      return res.status(400).json({ ok: false, error: 'guest_id_required' });
    }

    if (type === 'recent') {
      const url = String(body.url || '').trim();
      const platform = String(body.platform || '').slice(0, 32) || null;
      const title = body.title != null ? String(body.title).slice(0, 500) : null;
      if (!validHttpUrl(url)) {
        return res.status(400).json({ ok: false, error: 'invalid_url' });
      }
      await retentionInsertRecent({
        userId,
        guestKey,
        url,
        title,
        platform,
        createdAt: timestamp,
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'usage') {
      await retentionIncrementUsage({ userId, guestKey, lastUsedAtMs: timestamp });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'invalid_type' });
  } catch (e) {
    console.error('[retention]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
