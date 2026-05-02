/**
 * GET /api/ping-google — notifies Google of sitemap updates (Indexing API alternative: ping).
 */
import { handleCORS } from './cors.js';

const SITEMAP_URL = 'https://cutup.shop/sitemap.xml';

export default async function handler(req, res) {
  const corsEarly = handleCORS(req, res);
  if (corsEarly) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`;

  try {
    const googleRes = await fetch(pingUrl, {
      redirect: 'follow',
      headers: { Accept: 'text/html,*/*' },
    });
    const success = googleRes.ok;
    console.log('[seo] ping sent', { googleStatus: googleRes.status, success });
    return res.status(200).json({
      success,
      googleStatus: googleRes.status,
    });
  } catch (e) {
    console.error('[seo] ping-google failed', e?.message || e);
    return res.status(500).json({
      success: false,
      error: String(e?.message || e),
    });
  }
}
