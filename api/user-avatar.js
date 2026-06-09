/**
 * POST /api/user/avatar — save cropped profile photo (JPEG/PNG/WebP data URL).
 */
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'path';
import { dirname } from 'path';
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import {
  getUserIdByEmail,
  isBillingDbConfigured,
  updateUserAvatarUrl,
  getUserProfileApiPayload
} from './billing-repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AVATAR_DIR = join(__dirname, '..', 'website', 'user-avatars');
const MAX_DECODED_BYTES = 800 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function resolveSession(req) {
  const sessionId =
    req.headers['x-session-id'] || req.query?.session || req.body?.session;
  if (!sessionId) return { error: 'no_session', status: 401 };
  const session = sessions.get(sessionId);
  if (!session?.user?.email) return { error: 'invalid_session', status: 401 };
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return { error: 'session_expired', status: 401 };
  }
  return { session, email: session.user.email, sessionId };
}

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

function extForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

function isLocalAvatarPath(url) {
  return typeof url === 'string' && url.startsWith('/user-avatars/');
}

function tryRemoveLocalAvatar(url) {
  if (!isLocalAvatarPath(url)) return;
  const name = basename(url.split('?')[0]);
  const path = join(AVATAR_DIR, name);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* noop */
    }
  }
}

export default async function userAvatarHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'Service not configured' });
  }

  const ident = resolveSession(req);
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

  const userId = await getUserIdByEmail(ident.email);
  if (!userId) return res.status(404).json({ ok: false, error: 'user_not_found' });

  const prev = await getUserProfileApiPayload(ident.email);
  if (prev?.avatar_url) tryRemoveLocalAvatar(prev.avatar_url);

  if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });

  const ext = extForMime(parsed.mime);
  const stored = `${String(userId)}-${Date.now()}${ext}`;
  const dest = join(AVATAR_DIR, stored);

  try {
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(dest);
      ws.on('error', reject);
      ws.on('finish', resolve);
      ws.end(parsed.buf);
    });
  } catch (e) {
    console.error('[user-avatar] write failed', e);
    return res.status(500).json({ ok: false, error: 'upload_failed' });
  }

  const avatarUrl = `/user-avatars/${stored}?v=${Date.now()}`;
  const updated = await updateUserAvatarUrl(ident.email, avatarUrl);
  if (!updated.ok) {
    tryRemoveLocalAvatar(avatarUrl);
    return res.status(500).json({ ok: false, error: updated.error || 'update_failed' });
  }

  ident.session.user.picture = avatarUrl;

  return res.json({
    ok: true,
    avatar_url: avatarUrl,
    profile: updated.profile
  });
}
