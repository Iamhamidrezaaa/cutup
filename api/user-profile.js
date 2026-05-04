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
    return res.status(503).json({ ok: false, error: 'Service not configured' });
  }

  const ident = resolveSessionUser(req);
  if (ident.error) {
    return res.status(ident.status).json({ ok: false, error: ident.error });
  }
  const { email } = ident;

  try {
    if (req.method === 'GET') {
      let profile;
      try {
        profile = await getUserProfileApiPayload(email);
      } catch (e) {
        console.error('[user-profile] GET profile_error', e);
        return res.status(500).json({ ok: false, error: 'profile_error' });
      }
      if (!profile) {
        return res.status(404).json({ ok: false, error: 'user_not_found' });
      }
      return res.json({
        ok: true,
        profile: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          email: profile.email,
          phone: profile.phone,
          country: profile.country,
          address: profile.address,
          postal_code: profile.postal_code,
          incomplete: profile.incomplete
        }
      });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      let result;
      try {
        result = await upsertUserProfileFromApi(email, body);
      } catch (e) {
        console.error('[user-profile] POST profile_error', e);
        return res.status(500).json({ ok: false, error: 'profile_error' });
      }
      if (!result.ok) {
        const err = result.error || 'update_failed';
        if (err === 'profile_error') {
          return res.status(500).json({ ok: false, error: 'profile_error' });
        }
        const code =
          err === 'email_required' || err === 'email_mismatch'
            ? 400
            : err === 'not_found'
              ? 404
              : 400;
        return res.status(code).json({ ok: false, error: err });
      }
      const p = result.profile;
      return res.json({
        ok: true,
        success: true,
        profile: p
          ? {
              first_name: p.first_name,
              last_name: p.last_name,
              email: p.email,
              phone: p.phone,
              country: p.country,
              address: p.address,
              postal_code: p.postal_code,
              incomplete: p.incomplete
            }
          : null
      });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[user-profile] fatal', e);
    return res.status(500).json({ ok: false, error: 'profile_error' });
  }
}
