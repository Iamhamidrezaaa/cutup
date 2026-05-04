import bcrypt from 'bcryptjs';
import { setAdminPanelCorsHeaders } from './cors.js';
import { isBillingDbConfigured } from './db/pool.js';
import {
  getAdminByEmailForLogin,
  ensureAdminsSchema,
  syncPrimaryAdminAccount,
} from './admins-repository.js';
import {
  setAdminSessionCookie,
  generateAdminSessionToken,
  saveAdminSession,
} from './admin-panel-auth.js';
import { recordServerAuditEvent } from './audit-internal.js';

export default async function adminLoginHandler(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'not_configured' });
  }

  try {
    await ensureAdminsSchema();
    await syncPrimaryAdminAccount();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password ?? '');

    console.log('LOGIN INPUT:', email);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const admin = await getAdminByEmailForLogin(email);
    console.log('ADMIN FOUND:', admin?.email ?? null);

    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (admin.status !== 'active') {
      console.log('PASSWORD MATCH:', false, '(inactive)');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = bcrypt.compareSync(password, admin.password_hash);
    console.log('PASSWORD MATCH:', match);

    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const rememberMe = Boolean(body.rememberMe);
    const sessionMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const maxAgeSec = Math.floor(sessionMs / 1000);
    const token = generateAdminSessionToken();
    await saveAdminSession(
      token,
      { id: admin.id, email: admin.email, role: admin.role },
      sessionMs,
    );
    setAdminSessionCookie(res, token, maxAgeSec);

    void recordServerAuditEvent({
      eventType: 'security',
      eventName: 'admin_login',
      metadata: { adminId: admin.id, adminEmail: admin.email, role: admin.role },
      req
    });

    return res.json({ success: true, ok: true });
  } catch (e) {
    console.error('[admin-login]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
