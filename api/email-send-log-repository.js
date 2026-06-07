/**
 * Persist and query email_send_log rows.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureEmailSendLogSchema } from './email-send-log-bootstrap.js';

function deriveStatus(result) {
  if (result?.sent) return 'sent';
  if (result?.skipped) return 'skipped';
  return 'failed';
}

/**
 * @param {{
 *   template: string,
 *   recipient: string,
 *   subject?: string,
 *   provider?: string,
 *   messageId?: string,
 *   status?: string,
 *   error?: string,
 *   eventName?: string,
 *   idempotencyKey?: string,
 *   metadata?: Record<string, unknown>,
 * }} input
 */
export async function insertEmailSendLog(input) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureEmailSendLogSchema();

  const template = String(input.template || '').trim() || 'unknown';
  const recipient = String(input.recipient || '').trim();
  if (!recipient) return { ok: false, reason: 'missing_recipient' };

  const status = String(input.status || 'sent').trim() || 'sent';

  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO email_send_log
      (template_id, event_name, recipient_email, subject, provider, message_id, status, error_message, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id, created_at`,
    [
      template,
      input.eventName || null,
      recipient,
      input.subject || null,
      input.provider || null,
      input.messageId || null,
      status,
      input.error || null,
      input.idempotencyKey || null,
      JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    ],
  );

  return { ok: true, id: rows[0]?.id, createdAt: rows[0]?.created_at };
}

/**
 * Map sendEmail() result to a log row.
 */
export async function logEmailSendResult(result, extra = {}) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'invalid_result' };
  const recipient = String(result.to || extra.recipient || '').trim();
  if (!recipient) return { ok: false, reason: 'missing_recipient' };

  try {
    return await insertEmailSendLog({
      template: result.template || extra.template || 'unknown',
      recipient,
      subject: result.subject || extra.subject || null,
      provider: result.provider || extra.provider || null,
      messageId: result.messageId || null,
      status: deriveStatus(result),
      error: result.error || null,
      eventName: extra.eventName || null,
      idempotencyKey: extra.idempotencyKey || null,
      metadata: {
        htmlLength: result.htmlLength ?? null,
        from: result.from || null,
        ...(extra.metadata && typeof extra.metadata === 'object' ? extra.metadata : {}),
      },
    });
  } catch (err) {
    console.warn('[email-send-log] insert failed', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {{
 *   page?: number,
 *   limit?: number,
 *   recipient?: string,
 *   template?: string,
 *   status?: string,
 *   provider?: string,
 *   q?: string,
 * }} filters
 */
export async function listEmailSendLogs(filters = {}) {
  if (!isBillingDbConfigured()) {
    return { ok: false, reason: 'db_not_configured', logs: [], total: 0, page: 1, limit: 50, totalPages: 0 };
  }
  await ensureEmailSendLogSchema();

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  let n = 1;

  const recipient = String(filters.recipient || '').trim();
  if (recipient) {
    where.push(`lower(recipient_email) LIKE lower($${n})`);
    params.push(`%${recipient}%`);
    n += 1;
  }

  const template = String(filters.template || '').trim();
  if (template) {
    where.push(`template_id = $${n}`);
    params.push(template);
    n += 1;
  }

  const status = String(filters.status || '').trim();
  if (status) {
    where.push(`status = $${n}`);
    params.push(status);
    n += 1;
  }

  const provider = String(filters.provider || '').trim();
  if (provider) {
    where.push(`provider = $${n}`);
    params.push(provider);
    n += 1;
  }

  const q = String(filters.q || '').trim();
  if (q) {
    where.push(`(
      lower(recipient_email) LIKE lower($${n})
      OR lower(template_id) LIKE lower($${n})
      OR lower(COALESCE(subject, '')) LIKE lower($${n})
      OR lower(COALESCE(message_id, '')) LIKE lower($${n})
    )`);
    params.push(`%${q}%`);
    n += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const pool = getPool();
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM email_send_log ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  const listRes = await pool.query(
    `SELECT
      id,
      template_id AS template,
      recipient_email AS recipient,
      subject,
      provider,
      message_id,
      status,
      error_message AS error,
      created_at
     FROM email_send_log
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${n} OFFSET $${n + 1}`,
    [...params, limit, offset],
  );

  return {
    ok: true,
    logs: listRes.rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit) || 1),
  };
}
