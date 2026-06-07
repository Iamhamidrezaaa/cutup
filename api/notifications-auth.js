import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getUserIdByEmail, isBillingDbConfigured } from './billing-repository.js';

export function resolveNotificationUser(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return null;
  }
  if (!isBillingDbConfigured()) {
    res.status(503).json({ ok: false, error: 'db_not_configured' });
    return null;
  }
  const sessionId = req.headers['x-session-id'] || req.query?.session || req.body?.session;
  if (!sessionId) {
    res.status(401).json({ ok: false, error: 'no_session' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session?.user?.email) {
    res.status(401).json({ ok: false, error: 'invalid_session' });
    return null;
  }
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    res.status(401).json({ ok: false, error: 'session_expired' });
    return null;
  }
  return { email: session.user.email, sessionId };
}

export async function resolveNotificationUserId(req, res) {
  const auth = resolveNotificationUser(req, res);
  if (!auth) return null;
  const userId = await getUserIdByEmail(auth.email);
  if (!userId) {
    res.status(404).json({ ok: false, error: 'user_not_found' });
    return null;
  }
  return { ...auth, userId: String(userId) };
}

export async function loadNotificationService() {
  try {
    return await import('./notifications-service/index.js');
  } catch (err) {
    console.warn('[notifications] service bundle unavailable', err?.message);
    return null;
  }
}
