import { setCORSHeaders } from './cors.js';
import { requireSessionEmail } from './processing-enforcement.js';
import {
  listPublicCreatorWallPosts,
  getCreatorWallPublicStats,
  submitCreatorWallPost
} from './creator-wall-repository.js';
import { ensureCreatorWallSchema } from './creator-wall-bootstrap.js';
import { getCreatorWallActivityFeed } from './creator-wall-activity.js';

function readJsonBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString('utf8'));
    } catch {
      body = {};
    }
  }
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body && typeof body === 'object' ? body : {};
}

export default async function creatorWallHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const action = String(req.query?.action || 'feed').trim();

  try {
    await ensureCreatorWallSchema();

    if (req.method === 'GET' && action === 'stats') {
      const stats = await getCreatorWallPublicStats();
      return res.status(200).json({ ok: true, stats });
    }

    if (req.method === 'GET' && action === 'activity') {
      const events = getCreatorWallActivityFeed({ limit: 16 });
      return res.status(200).json({ ok: true, events });
    }

    if (req.method === 'GET' && action === 'feed') {
      const limit = Math.min(48, Number(req.query?.limit) || 24);
      const { posts, source } = await listPublicCreatorWallPosts({ limit });
      return res.status(200).json({ ok: true, posts, source });
    }

    if (req.method === 'POST' && action === 'submit') {
      const email = requireSessionEmail(req, res);
      if (!email) return;

      const body = readJsonBody(req);
      if (!body.optIn) {
        return res.status(400).json({ ok: false, error: 'opt_in_required' });
      }

      const feedback = String(body.feedback || '').trim();
      if (feedback.length < 8) {
        return res.status(400).json({
          ok: false,
          error: 'feedback_too_short',
          message: 'Share a short quote (at least 8 characters).'
        });
      }

      const result = await submitCreatorWallPost({
        userEmail: email,
        stylePreset: body.stylePreset,
        platform: body.platform,
        language: body.language,
        countryCode: body.countryCode,
        feedback,
        creatorName: body.creatorName,
        socialHandle: body.socialHandle,
        thumbnailUrl: body.thumbnailUrl,
        previewVideoUrl: body.previewVideoUrl,
        exportJobId: body.exportJobId,
        processingSec: body.processingSec,
        resolution: body.resolution
      });

      return res.status(201).json({
        ok: true,
        ...result,
        message: 'Thanks! Your export is pending review for the Creator Wall.'
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[creator-wall]', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: err?.message });
  }
}
