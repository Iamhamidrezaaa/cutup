import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://cutup.shop/api/auth/callback';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://cutup.shop';

// In-memory session store (in production, use Redis or database)
const sessions = new Map();

// Export sessions for use in other modules
export { sessions };

export default async function handler(req, res) {
  const { method, query, body } = req;
  const action = query.action || body?.action;

  // Initialize OAuth client
  const oAuth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  try {
    // Get Google OAuth URL
    if (method === 'GET' && action === 'login') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ 
          error: 'Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' 
        });
      }

      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ],
        include_granted_scopes: true
      });

      return res.json({ authUrl });
    }

    // Handle OAuth callback
    if (method === 'GET' && action === 'callback') {
      const { code } = query;

      if (!code) {
        return res.redirect(`${FRONTEND_URL}?error=no_code`);
      }

      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return res.redirect(`${FRONTEND_URL}?error=oauth_not_configured`);
      }

      // Exchange code for tokens
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      // Get user info
      const ticket = await oAuth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();
      const user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        given_name: payload.given_name,
        family_name: payload.family_name,
        first_name: payload.given_name || null,
        last_name: payload.family_name || null
      };

      const { getActiveAdminByEmail } = await import('./user-roles.js');
      if (await getActiveAdminByEmail(user.email)) {
        return res.redirect(`${FRONTEND_URL}/?error=admin_account`);
      }

      try {
        const { resolveLoginBlockForEmail, buildLoginBlockedRedirectUrl } = await import(
          './account-security-repository.js'
        );
        const { isBillingDbConfigured } = await import('./billing-repository.js');
        if (isBillingDbConfigured()) {
          const block = await resolveLoginBlockForEmail(user.email);
          if (block.blocked) {
            console.log('[login-blocked]', {
              email: user.email,
              reason: block.reason,
              unlock: block.unlockDateLabel || null
            });
            const loginUrl = buildLoginBlockedRedirectUrl(FRONTEND_URL, user.email);
            return res.redirect(loginUrl);
          }
        }
      } catch (cooldownErr) {
        console.warn('[auth] login block check failed:', cooldownErr?.message);
      }

      // Create session
      const sessionId = generateSessionId();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      sessions.set(sessionId, {
        user,
        tokens,
        createdAt: Date.now(),
        expiresAt
      });

      try {
        const {
          ensureUserByEmail,
          isBillingDbConfigured,
          syncUserDisplayNameFromGoogleProfile
        } = await import('./billing-repository.js');
        if (isBillingDbConfigured()) {
          const userId = await ensureUserByEmail(user.email);
          await syncUserDisplayNameFromGoogleProfile(user.email, {
            name: user.name,
            given_name: user.given_name,
            family_name: user.family_name
          });
          try {
            const { registerCustomerSession } = await import('./account-security-repository.js');
            await registerCustomerSession(userId, sessionId, expiresAt);
          } catch (regErr) {
            console.warn('[auth] registerCustomerSession:', regErr?.message);
          }
          try {
            const { getPool } = await import('./db/pool.js');
            const pool = getPool();
            const created = await pool.query(
              'SELECT created_at FROM users WHERE id = $1::uuid LIMIT 1',
              [userId]
            );
            const ts = created.rows[0]?.created_at;
            if (ts && Date.now() - new Date(ts).getTime() < 120000) {
              const { emitUserRegistered } = await import('./email-events-bus.js');
              void emitUserRegistered({
                email: user.email,
                userId,
                firstName: user.given_name || user.name?.split(' ')?.[0] || 'there',
              });
            }
          } catch (welcomeErr) {
            console.warn('[auth] welcome email skipped:', welcomeErr?.message);
          }
        }
      } catch (e) {
        console.error('[auth] ensureUserByEmail failed:', e.message);
      }

      // Clean up expired sessions
      cleanupExpiredSessions();

      // Dashboard is default post-login; client checks localStorage for tool resume → homepage
      return res.redirect(`${FRONTEND_URL}/dashboard.html?auth=success&session=${sessionId}`);
    }

    // Get current user
    if (method === 'GET' && action === 'me') {
      const sessionId = req.headers['x-session-id'] || query.session;

      if (!sessionId) {
        return res.status(401).json({ error: 'No session provided' });
      }

      const session = sessions.get(sessionId);

      if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      // Check if session expired
      if (Date.now() > session.expiresAt) {
        sessions.delete(sessionId);
        return res.status(401).json({ error: 'Session expired' });
      }

      const payload = await buildCustomerAuthMePayload(session);
      return res.json(payload);
    }

    // Logout
    if (method === 'POST' && action === 'logout') {
      const sessionId = req.headers['x-session-id'] || body?.session;

      if (sessionId) {
        sessions.delete(sessionId);
        try {
          const { removeCustomerSession } = await import('./account-security-repository.js');
          await removeCustomerSession(sessionId);
        } catch (_e) {
          /* noop */
        }
      }

      return res.json({ success: true });
    }

    // Verify session
    if (method === 'POST' && action === 'verify') {
      const sessionId = req.headers['x-session-id'] || body?.session;

      if (!sessionId) {
        return res.status(401).json({ error: 'No session provided' });
      }

      const session = sessions.get(sessionId);

      if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      if (Date.now() > session.expiresAt) {
        sessions.delete(sessionId);
        return res.status(401).json({ error: 'Session expired' });
      }

      const payload = await buildCustomerAuthMePayload(session);
      return res.json({ valid: true, user: payload.user, platformRole: payload.platformRole });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      error: 'Authentication failed', 
      message: error.message 
    });
  }
}

async function buildCustomerAuthMePayload(session) {
  let user = session.user;
  try {
    const { mergeSessionUserWithProfile, isBillingDbConfigured } = await import('./billing-repository.js');
    if (isBillingDbConfigured()) {
      user = await mergeSessionUserWithProfile(session.user);
    }
  } catch (e) {
    console.warn('[auth] mergeSessionUserWithProfile:', e?.message);
  }
  const { getActiveAdminByEmail, platformRoleFromAdminRow, CUSTOMER_ROLE } = await import('./user-roles.js');
  const adminRow = await getActiveAdminByEmail(user?.email);
  const platformRole = adminRow ? platformRoleFromAdminRow(adminRow) : CUSTOMER_ROLE;
  return { user, platformRole };
}

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(sessionId);
      import('./account-security-repository.js')
        .then((m) => m.removeCustomerSession(sessionId))
        .catch(() => {});
    }
  }
}

/** Revoke in-memory sessions for same email except keepSessionId. */
export function revokeOtherSessionsInMemory(email, keepSessionId) {
  const em = String(email || '').trim().toLowerCase();
  let revoked = 0;
  for (const [sid, sess] of sessions.entries()) {
    if (sid === keepSessionId) continue;
    if (String(sess.user?.email || '').trim().toLowerCase() === em) {
      sessions.delete(sid);
      revoked += 1;
    }
  }
  return revoked;
}

