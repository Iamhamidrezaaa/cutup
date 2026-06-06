/**
 * Projects API — authenticated workspace persistence.
 *
 * GET  /api/projects?action=list&filter=&search=&page=&limit=
 * GET  /api/projects?action=get&id=
 * GET  /api/projects?action=restore&id=
 * POST /api/projects?action=rename
 * POST /api/projects?action=duplicate
 * POST /api/projects?action=archive
 * POST /api/projects?action=delete
 */
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { ensureProjectsSchema } from './db/ensure-projects-schema.js';
import {
  isProjectsDbConfigured,
  listProjectsDb,
  getProjectDetailDb,
  renameProjectDb,
  duplicateProjectDb,
  archiveProjectDb,
  deleteProjectDb,
  buildProjectRestorePayloadDb,
  getLatestExportForProjectDb
} from './projects-repository.js';

export default async function handler(req, res) {
  setCORSHeaders(res);

  const { method, query } = req;
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch (_e) {
      body = {};
    }
  }
  if (!body) body = {};

  const action = query.action || body.action;
  const sessionId = req.headers['x-session-id'] || query.session || body.session;

  if (!isProjectsDbConfigured()) {
    return res.status(503).json({
      error: 'DATABASE_URL is not configured',
      hint: 'Set DATABASE_URL and run: node api/db/migrate.mjs'
    });
  }

  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session?.user?.email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userEmail = session.user.email;

  try {
    await ensureProjectsSchema();

    if (method === 'GET' && action === 'list') {
      const result = await listProjectsDb(userEmail, {
        filter: query.filter || 'all',
        search: query.search || '',
        page: query.page,
        limit: query.limit
      });
      return res.json({ ok: true, ...result });
    }

    if (method === 'GET' && action === 'get') {
      const id = query.id || body.id;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const detail = await getProjectDetailDb(userEmail, id);
      if (!detail) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true, ...detail });
    }

    if (method === 'GET' && action === 'restore') {
      const id = query.id || body.id;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const payload = await buildProjectRestorePayloadDb(userEmail, id);
      if (!payload) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true, payload });
    }

    if (method === 'GET' && action === 'latestExport') {
      const id = query.id || body.id;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const exp = await getLatestExportForProjectDb(userEmail, id);
      return res.json({ ok: true, export: exp });
    }

    if (method === 'POST' && action === 'rename') {
      const { id, title } = body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const ok = await renameProjectDb(userEmail, id, title);
      if (!ok) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true });
    }

    if (method === 'POST' && action === 'duplicate') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const newId = await duplicateProjectDb(userEmail, id);
      if (!newId) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true, id: newId });
    }

    if (method === 'POST' && action === 'archive') {
      const { id, archived = true } = body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const ok = await archiveProjectDb(userEmail, id, Boolean(archived));
      if (!ok) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true });
    }

    if (method === 'POST' && action === 'delete') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const ok = await deleteProjectDb(userEmail, id);
      if (!ok) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('[projects]', error?.stack || error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'Projects error',
      message: error.message,
      code: error.code || null,
      hint:
        error.code === '42P01'
          ? 'Run: node api/db/migrate.mjs (schema-projects.sql)'
          : undefined
    });
  }
}
