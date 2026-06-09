/**
 * POST /api/user/avatar — save cropped profile photo to PostgreSQL.
 */
import { setCORSHeaders } from './cors.js';
import { resolveCustomerSession } from './session-resolve.js';
import {
  getUserIdByEmail,
  isBillingDbConfigured,
  updateUserAvatarBytes,
  getUserProfileApiPayload
} from './billing-repository.js';

const MAX_DECODED_BYTES = 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parseDataUrl(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  let buf;
  try {
    buf = Buffer.from(m[2], 'base64');
  } catch {
    return null;
  }
  if (!buf.length || buf.length > MAX_DECODED_BYTES) return null;
  return { mime, buf };
}

function publicAvatarUrl(userId) {
  return `/api/user/avatar/photo?u=${encodeURIComponent(String(userId))}&v=${Date.now()}`;
}

export default async function userAvatarHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'Service not configured' });
  }

  const ident = await resolveCustomerSession(req);
  if (ident.error) {
    return res.status(ident.status).json({ ok: false, error: ident.error });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const parsed = parseDataUrl(body.image);
  if (!parsed) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_image',
      maxBytes: MAX_DECODED_BYTES
    });
  }

  const userId = ident.userId || (await getUserIdByEmail(ident.email));
  if (!userId) return res.status(404).json({ ok: false, error: 'user_not_found' });

  const avatarUrl = publicAvatarUrl(userId);
  const updated = await updateUserAvatarBytes(ident.email, {
    bytes: parsed.buf,
    mime: parsed.mime,
    avatarUrl
  });

  if (!updated.ok) {
    console.error('[user-avatar] update failed', updated.error);
    return res.status(500).json({ ok: false, error: updated.error || 'update_failed' });
  }

  ident.session.user.picture = avatarUrl;
  if (ident.session.user) ident.session.user.avatar_url = avatarUrl;

  return res.json({
    ok: true,
    avatar_url: avatarUrl,
    profile: updated.profile || (await getUserProfileApiPayload(ident.email))
  });
}
