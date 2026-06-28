import { setCORSHeaders } from './cors.js';
import {
  getStorageLifecycleSnapshot,
  runStorageLifecycleCleanup
} from './infrastructure/storage-lifecycle.js';

function verifyCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = String(req.headers?.authorization || '');
  return auth === `Bearer ${secret}`;
}

export default async function cronStorageLifecycleHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!verifyCron(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const snapshot = getStorageLifecycleSnapshot();
    const result = await runStorageLifecycleCleanup();
    return res.status(200).json({
      ok: true,
      snapshot,
      cleanup: result
    });
  } catch (err) {
    console.error('[cron-storage-lifecycle]', err);
    return res.status(500).json({ ok: false, error: 'cron_failed' });
  }
}
