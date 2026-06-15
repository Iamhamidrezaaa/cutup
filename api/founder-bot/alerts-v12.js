/**
 * Founder Bot V1.2 — enriched export failure alerts.
 */
import { queueTelegramMessage } from './telegram.js';
import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { formatDurationSec, languageLabel } from './metrics-v12.js';

async function resolveExportContext(payload = {}) {
  const ctx = {
    userName: null,
    projectName: payload.projectName || null,
    language: null,
    durationSec: payload.videoDurationSec ?? payload.renderDurationSec ?? null
  };

  if (payload.exportDoc?.targetLanguage) {
    ctx.language = payload.exportDoc.targetLanguage;
  } else if (payload.exportDoc?.sourceLanguage) {
    ctx.language = payload.exportDoc.sourceLanguage;
  } else if (payload.selectedVersion === 'translated') {
    ctx.language = 'translated';
  } else if (payload.selectedVersion === 'original') {
    ctx.language = 'original';
  }

  if (!isBillingDbConfigured()) return ctx;

  try {
    const pool = getPool();
    if (payload.email) {
      const userR = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(up.first_name), ''), NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS name
         FROM users u
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE lower(u.email) = lower($1)
         LIMIT 1`,
        [payload.email]
      );
      ctx.userName = userR.rows[0]?.name || null;
    }

    if (payload.jobId) {
      const projR = await pool.query(
        `SELECT p.title, p.language, e.metadata
         FROM project_exports e
         LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.render_job_id = $1
         LIMIT 1`,
        [payload.jobId]
      );
      const row = projR.rows[0];
      if (row) {
        if (!ctx.projectName && row.title) ctx.projectName = row.title;
        if (!ctx.language && row.language) ctx.language = row.language;
        if (!ctx.language && row.metadata?.language) ctx.language = row.metadata.language;
      }
    }
  } catch (_e) {
    /* noop */
  }

  return ctx;
}

function sanitizeReason(error) {
  const raw = String(error || 'Unknown error').trim();
  return raw
    .replace(/\s+/g, ' ')
    .slice(0, 280)
    .toLowerCase();
}

export async function onExportFailedV12(payload = {}) {
  try {
    const ctx = await resolveExportContext(payload);
    const user =
      ctx.userName ||
      (payload.email ? String(payload.email).split('@')[0] : '—');
    const project = ctx.projectName || payload.presetId || '—';
    const language = languageLabel(ctx.language);
    const duration = formatDurationSec(ctx.durationSec);
    const reason = sanitizeReason(payload.error);

    const text = [
      '🚨 Export Failed',
      '',
      `User: ${user}`,
      '',
      'Project:',
      project,
      '',
      'Language:',
      language,
      '',
      'Duration:',
      duration,
      '',
      'Reason:',
      reason
    ].join('\n');

    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onExportFailedV12', err?.message || err);
  }
}

export function founderAlertExportFailedV12(payload) {
  void onExportFailedV12(payload).catch(() => {});
}
