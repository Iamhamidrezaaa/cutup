import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';

export default async function adminAuthMeHandler(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const auth = await resolveAdminAuth(req);
  if (!auth) {
    return res.status(401).json({ ok: false });
  }
  return res.json({ ok: true, email: auth.email, role: auth.role, adminId: auth.adminId });
}
