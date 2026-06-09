import { sessions } from './auth.js';
import { isBillingDbConfigured } from './billing-repository.js';
import { getPool } from './db/pool.js';

/**
 * Resolve customer session from memory or customer_sessions (multi-instance / cold start).
 */
export async function resolveCustomerSession(req) {
  const sessionId =
    req.headers?.['x-session-id'] ||
    req.headers?.['X-Session-Id'] ||
    req.query?.session ||
    req.body?.session;

  if (!sessionId) return { error: 'no_session', status: 401 };

  let session = sessions.get(String(sessionId));
  if (session?.user?.email) {
    if (session.expiresAt && Date.now() > session.expiresAt) {
      sessions.delete(String(sessionId));
      return { error: 'session_expired', status: 401 };
    }
    return { session, email: session.user.email, sessionId: String(sessionId) };
  }

  if (!isBillingDbConfigured()) {
    return { error: 'invalid_session', status: 401 };
  }

  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT cs.expires_at, u.email, u.id AS user_id
       FROM customer_sessions cs
       JOIN users u ON u.id = cs.user_id
       WHERE cs.session_id = $1 AND cs.expires_at > NOW()
       LIMIT 1`,
      [String(sessionId)]
    );
    const row = r.rows[0];
    if (!row?.email) return { error: 'invalid_session', status: 401 };

    session = {
      user: { email: row.email, id: row.user_id },
      expiresAt: new Date(row.expires_at).getTime()
    };
    sessions.set(String(sessionId), session);
    return { session, email: row.email, sessionId: String(sessionId), userId: row.user_id };
  } catch (e) {
    console.error('[session-resolve] db lookup failed', e?.message);
    return { error: 'invalid_session', status: 401 };
  }
}
