import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { ensureCreatorWallSchema } from './creator-wall-bootstrap.js';
import {
  listAdminCreatorWallPosts,
  moderateCreatorWallPost,
  createAdminCreatorWallPost
} from './creator-wall-repository.js';

function readJsonBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  return {};
}

export default async function adminCreatorWallHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = await resolveAdminAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const schema = await ensureCreatorWallSchema();
  if (!schema.ok) {
    return res.status(503).json({ ok: false, error: 'creator_wall_unavailable', degraded: true });
  }

  try {
    if (req.method === 'GET') {
      const posts = await listAdminCreatorWallPosts();
      const pending = posts.filter((p) => !p.approved && !p.hidden).length;
      return res.status(200).json({ ok: true, posts, pending });
    }

    if (req.method === 'POST') {
      const body = readJsonBody(req);
      const action = String(body.action || '').trim();

      if (action === 'moderate') {
        const id = body.id;
        if (!id) return res.status(400).json({ ok: false, error: 'id_required' });
        const ok = await moderateCreatorWallPost(id, {
          approved: body.approved,
          featured: body.featured,
          hidden: body.hidden,
          sortOrder: body.sortOrder
        });
        if (!ok) return res.status(404).json({ ok: false, error: 'not_found' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'create') {
        const id = await createAdminCreatorWallPost(body);
        return res.status(200).json({ ok: true, id });
      }

      return res.status(400).json({ ok: false, error: 'unknown_action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin-creator-wall]', err);
    return res.status(500).json({ ok: false, error: err?.message });
  }
}
