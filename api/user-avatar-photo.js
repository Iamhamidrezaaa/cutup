/**
 * GET /api/user/avatar/photo?u={userId}&v={cacheBust}
 */
import { setCORSHeaders } from './cors.js';
import { getUserAvatarBytes, isBillingDbConfigured } from './billing-repository.js';

export default async function userAvatarPhotoHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return res.status(405).end();

  if (!isBillingDbConfigured()) return res.status(503).end();

  const userId = String(req.query?.u || '').trim();
  if (!userId) return res.status(400).end();

  const row = await getUserAvatarBytes(userId);
  if (!row?.bytes?.length) return res.status(404).end();

  res.setHeader('Content-Type', row.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  return res.status(200).send(row.bytes);
}
