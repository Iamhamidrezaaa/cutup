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
        prompt: 'consent',
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
        family_name: payload.family_name
      };

      // Create session
      const sessionId = generateSessionId();
      sessions.set(sessionId, {
        user,
        tokens,
        createdAt: Date.now(),
        expiresAt: Date.now() + (6 * 60 * 60 * 1000) // 6 hours
      });

      // Clean up expired sessions
      cleanupExpiredSessions();

      // Redirect to dashboard with session token
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

      return res.json({ user: session.user });
    }

    // Logout
    if (method === 'POST' && action === 'logout') {
      const sessionId = req.headers['x-session-id'] || body?.session;

      if (sessionId) {
        sessions.delete(sessionId);
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

      return res.json({ valid: true, user: session.user });
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

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(sessionId);
    }
  }
}

