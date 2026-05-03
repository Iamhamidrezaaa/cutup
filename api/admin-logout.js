import { setAdminPanelCorsHeaders } from './cors.js';
import { clearAdminSessionCookie, getCookie, destroyAdminSessionToken, ADMIN_SESSION_COOKIE } from './admin-panel-auth.js';

export default async function adminLogoutHandler(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const token = getCookie(req, ADMIN_SESSION_COOKIE);
  await destroyAdminSessionToken(token);
  clearAdminSessionCookie(res);
  return res.json({ ok: true });
}
