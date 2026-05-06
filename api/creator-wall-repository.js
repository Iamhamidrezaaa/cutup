import { getPool } from './db/pool.js';
import { ensureCreatorWallSchema } from './creator-wall-bootstrap.js';
import { CURATED_CREATOR_WALL_POSTS, getCuratedPublicStats } from './creator-wall-seed-data.js';
import { getStylePreset, listStylePresets } from './video-render/style-presets.js';

const PRESET_LABELS = Object.fromEntries(
  listStylePresets().map((p) => [p.id, p.name])
);

const FRONTEND_PRESET_ALIASES = {
  hormozi: 'alexHormozi',
  mrbeast: 'mrBeast',
  'ali-abdaal': 'aliAbdaal',
  'tiktok-neon': 'tiktokNeon',
  'luxury-minimal': 'luxuryMinimal',
  podcast: 'podcast'
};

function resolvePresetLabel(presetId) {
  if (PRESET_LABELS[presetId]) return PRESET_LABELS[presetId];
  try {
    return getStylePreset(presetId).name;
  } catch {
    return presetId;
  }
}

function rowToPublic(row) {
  const stats = row.stats_json && typeof row.stats_json === 'object' ? row.stats_json : {};
  return {
    id: String(row.id),
    thumbnailUrl: row.thumbnail_url || null,
    previewVideoUrl: row.preview_video_url || null,
    stylePreset: row.style_preset,
    presetLabel: resolvePresetLabel(row.style_preset),
    platform: row.platform || 'youtube',
    language: row.language || 'en',
    countryCode: row.country_code || 'US',
    feedback: row.feedback || '',
    creatorName: row.creator_name || 'Creator',
    socialHandle: row.social_handle || null,
    statsJson: stats,
    featured: Boolean(row.featured),
    cardSize: stats.cardSize || 'standard',
    createdAt: row.created_at
  };
}

function seedToPublic(item) {
  return {
    id: item.id,
    thumbnailUrl: null,
    previewVideoUrl: null,
    stylePreset: item.stylePreset,
    presetLabel: item.presetLabel || resolvePresetLabel(item.stylePreset),
    platform: item.platform,
    language: item.language,
    countryCode: item.countryCode,
    feedback: item.feedback,
    creatorName: item.creatorName,
    socialHandle: item.socialHandle,
    statsJson: item.statsJson || {},
    captionLines: item.captionLines || null,
    featured: Boolean(item.featured),
    cardSize: item.cardSize || 'standard',
    createdAt: item.createdAt,
    seed: true
  };
}

export async function listPublicCreatorWallPosts({ limit = 24 } = {}) {
  const schema = await ensureCreatorWallSchema();
  if (!schema.ok) {
    return { posts: CURATED_CREATOR_WALL_POSTS.map(seedToPublic), source: 'curated' };
  }

  const pool = getPool();
  const r = await pool.query(
    `SELECT id, thumbnail_url, preview_video_url, style_preset, platform, language, country_code,
            feedback, creator_name, social_handle, stats_json, featured, created_at
     FROM creator_wall_posts
     WHERE approved = true AND hidden = false
     ORDER BY featured DESC, sort_order DESC, created_at DESC
     LIMIT $1`,
    [Math.min(48, Math.max(1, limit))]
  );

  if (!r.rows.length) {
    return { posts: CURATED_CREATOR_WALL_POSTS.map(seedToPublic), source: 'curated' };
  }

  return { posts: r.rows.map(rowToPublic), source: 'database' };
}

export async function getCreatorWallPublicStats() {
  const schema = await ensureCreatorWallSchema();
  const curated = getCuratedPublicStats();

  if (!schema.ok) return curated;

  const pool = getPool();
  try {
    const weekR = await pool.query(
      `SELECT COUNT(*)::int AS c FROM creator_wall_posts
       WHERE approved = true AND created_at >= NOW() - INTERVAL '7 days'`
    );
    const allR = await pool.query(
      `SELECT COUNT(*)::int AS total FROM creator_wall_posts WHERE approved = true`
    );
    const weekCount = Number(weekR.rows[0]?.c || 0);
    const total = Number(allR.rows[0]?.total || 0);
    const boost = curated.videosThisWeek + total * 3 + weekCount * 12;

    return {
      videosThisWeek: Math.max(boost, curated.videosThisWeek),
      subtitlesGenerated: curated.subtitlesGenerated + total * 120,
      creatorsOnboarded: curated.creatorsOnboarded + Math.floor(total * 2.5),
      exportMinutesRendered: curated.exportMinutesRendered + total * 18,
      source: total > 0 ? 'hybrid' : curated.source,
      phase: 1,
      serverTime: Date.now(),
      incrementRates: curated.incrementRates
    };
  } catch {
    return curated;
  }
}

export async function submitCreatorWallPost(payload) {
  await ensureCreatorWallSchema();
  const pool = getPool();

  const stylePreset = String(payload.stylePreset || 'hormozi').slice(0, 64);
  const feedback = String(payload.feedback || '').trim().slice(0, 500);
  const creatorName = String(payload.creatorName || '').trim().slice(0, 120);
  const socialHandle = String(payload.socialHandle || '').trim().slice(0, 120);
  const platform = String(payload.platform || 'youtube').slice(0, 32);
  const language = String(payload.language || 'en').slice(0, 16);
  const countryCode = String(payload.countryCode || '').trim().toUpperCase().slice(0, 8);

  const statsJson = {
    processingSec: payload.processingSec != null ? Number(payload.processingSec) : null,
    resolution: payload.resolution || null,
    exportJobId: payload.exportJobId || null
  };

  const r = await pool.query(
    `INSERT INTO creator_wall_posts (
       thumbnail_url, preview_video_url, style_preset, platform, language, country_code,
       feedback, creator_name, social_handle, stats_json, user_email, export_job_id,
       approved, featured, hidden
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,false,false,false)
     RETURNING id, created_at`,
    [
      payload.thumbnailUrl || null,
      payload.previewVideoUrl || null,
      stylePreset,
      platform,
      language,
      countryCode || null,
      feedback || null,
      creatorName || null,
      socialHandle || null,
      JSON.stringify(statsJson),
      payload.userEmail || null,
      payload.exportJobId || null
    ]
  );

  return { id: r.rows[0].id, createdAt: r.rows[0].created_at, pendingApproval: true };
}

export async function listAdminCreatorWallPosts() {
  await ensureCreatorWallSchema();
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, thumbnail_url, preview_video_url, style_preset, platform, language, country_code,
            feedback, creator_name, social_handle, stats_json, user_email, export_job_id,
            approved, featured, hidden, sort_order, created_at, updated_at
     FROM creator_wall_posts
     ORDER BY created_at DESC
     LIMIT 200`
  );
  return r.rows.map((row) => ({
    ...rowToPublic(row),
    approved: Boolean(row.approved),
    hidden: Boolean(row.hidden),
    sortOrder: row.sort_order,
    userEmail: row.user_email,
    exportJobId: row.export_job_id,
    updatedAt: row.updated_at
  }));
}

export async function moderateCreatorWallPost(id, patch) {
  await ensureCreatorWallSchema();
  const pool = getPool();
  const sets = [];
  const vals = [];
  let i = 1;

  if (patch.approved != null) {
    sets.push(`approved = $${i++}`);
    vals.push(Boolean(patch.approved));
  }
  if (patch.featured != null) {
    sets.push(`featured = $${i++}`);
    vals.push(Boolean(patch.featured));
  }
  if (patch.hidden != null) {
    sets.push(`hidden = $${i++}`);
    vals.push(Boolean(patch.hidden));
  }
  if (patch.sortOrder != null) {
    sets.push(`sort_order = $${i++}`);
    vals.push(Number(patch.sortOrder) || 0);
  }

  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  const r = await pool.query(
    `UPDATE creator_wall_posts SET ${sets.join(', ')} WHERE id = $${i}::uuid RETURNING id`,
    vals
  );
  return r.rowCount > 0;
}

export async function createAdminCreatorWallPost(body) {
  await ensureCreatorWallSchema();
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO creator_wall_posts (
       thumbnail_url, preview_video_url, style_preset, platform, language, country_code,
       feedback, creator_name, social_handle, stats_json, approved, featured, hidden, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)
     RETURNING id`,
    [
      body.thumbnailUrl || null,
      body.previewVideoUrl || null,
      body.stylePreset || 'hormozi',
      body.platform || 'youtube',
      body.language || 'en',
      body.countryCode || 'US',
      body.feedback || '',
      body.creatorName || 'Creator',
      body.socialHandle || null,
      JSON.stringify(body.statsJson || {}),
      body.approved !== false,
      Boolean(body.featured),
      Boolean(body.hidden),
      Number(body.sortOrder) || 0
    ]
  );
  return r.rows[0].id;
}

export { FRONTEND_PRESET_ALIASES, resolvePresetLabel };
