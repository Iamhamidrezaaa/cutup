import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import {
  isBillingDbConfigured,
  getUserProfileApiPayload,
  upsertUserProfileFromApi
} from './billing-repository.js';

function resolveSessionUser(req) {
  const sessionId = req.headers['x-session-id'] || req.query?.session || req.body?.session;
  if (!sessionId) return { error: 'no_session', status: 401 };
  const session = sessions.get(sessionId);
  if (!session || !session.user?.email) return { error: 'invalid_session', status: 401 };
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return { error: 'session_expired', status: 401 };
  }
  return { session, email: session.user.email };
}

export default async function userProfileHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Service not configured' });
  }

  const ident = resolveSessionUser(req);
  if (ident.error) {
    return res.status(ident.status).json({ error: ident.error });
  }
  const { email } = ident;

  try {
    if (req.method === 'GET') {
      const profile = await getUserProfileApiPayload(email);
      if (!profile) return res.status(404).json({ error: 'user_not_found' });
      return res.json({ profile });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await upsertUserProfileFromApi(email, body);
      if (!result.ok) {
        const code =
          result.error === 'email_required' || result.error === 'email_mismatch'
            ? 400
            : result.error === 'not_found'
              ? 404
              : 400;
        return res.status(code).json({ error: result.error || 'update_failed' });
      }
      return res.json({ success: true, profile: result.profile });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[user-profile]', e);
    return res.status(500).json({ error: 'Request failed', message: e?.message });
  }
}
