import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureEmailSendLogSchema } from './email-send-log-bootstrap.js';
import { resolvePlanKey } from './plans/permissions.js';
import { inferFirstNameFromEmail } from './offer-email-content.js';
import { sendTemplatedEmail } from './email-events-bus.js';

export function normalizeBroadcastPlan(plan) {
  return resolvePlanKey(plan || 'free');
}

function buildAudienceQuery({ template, mode, plan, excludeAlreadySent }) {
  const normalizedPlan = normalizeBroadcastPlan(plan);
  const params = [];
  let n = 1;
  let fromSql = '';
  let whereSql = `WHERE u.email IS NOT NULL AND trim(u.email) <> ''`;

  if (mode === 'plan') {
    fromSql = `
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      INNER JOIN subscriptions s ON s.user_id = u.id`;
    whereSql += ` AND lower(coalesce(s.plan, 'free')) = $${n}`;
    params.push(normalizedPlan);
    n += 1;
  } else {
    fromSql = `
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id`;
  }

  if (excludeAlreadySent !== false) {
    whereSql += ` AND NOT EXISTS (
      SELECT 1 FROM email_send_log esl
      WHERE esl.template_id = $${n}
        AND lower(esl.recipient_email) = lower(u.email)
        AND esl.status = 'sent'
    )`;
    params.push(String(template || '').trim());
    n += 1;
  }

  return { fromSql, whereSql, params, normalizedPlan };
}

export async function countEmailAudience({ template, mode = 'all', plan = 'free', excludeAlreadySent = true }) {
  if (!isBillingDbConfigured()) {
    return { ok: false, matchedUsers: 0, skippedAlreadySent: 0, totalInScope: 0 };
  }
  await ensureEmailSendLogSchema();
  const pool = getPool();
  const tpl = String(template || '').trim();
  if (!tpl) return { ok: false, matchedUsers: 0, skippedAlreadySent: 0, totalInScope: 0 };

  const scopeAll = buildAudienceQuery({ template: tpl, mode, plan, excludeAlreadySent: false });
  const totalRes = await pool.query(
    `SELECT COUNT(DISTINCT lower(u.email))::int AS c ${scopeAll.fromSql} ${scopeAll.whereSql}`,
    scopeAll.params
  );
  const totalInScope = Number(totalRes.rows?.[0]?.c || 0);

  const eligible = buildAudienceQuery({ template: tpl, mode, plan, excludeAlreadySent });
  const eligibleRes = await pool.query(
    `SELECT COUNT(DISTINCT lower(u.email))::int AS c ${eligible.fromSql} ${eligible.whereSql}`,
    eligible.params
  );
  const matchedUsers = Number(eligibleRes.rows?.[0]?.c || 0);

  return {
    ok: true,
    mode,
    plan: mode === 'plan' ? normalizeBroadcastPlan(plan) : null,
    template: tpl,
    excludeAlreadySent: excludeAlreadySent !== false,
    matchedUsers,
    skippedAlreadySent: Math.max(0, totalInScope - matchedUsers),
    totalInScope,
  };
}

export async function listEmailAudience({
  template,
  mode = 'all',
  plan = 'free',
  excludeAlreadySent = true,
  limit = 5000,
}) {
  if (!isBillingDbConfigured()) return [];
  await ensureEmailSendLogSchema();
  const pool = getPool();
  const tpl = String(template || '').trim();
  if (!tpl) return [];

  const q = buildAudienceQuery({ template: tpl, mode, plan, excludeAlreadySent });
  const lim = Math.min(10000, Math.max(1, Number(limit) || 5000));
  const r = await pool.query(
    `SELECT DISTINCT ON (lower(u.email))
        u.email,
        up.first_name,
        up.last_name
     ${q.fromSql}
     ${q.whereSql}
     ORDER BY lower(u.email), u.created_at DESC NULLS LAST
     LIMIT $${q.params.length + 1}`,
    [...q.params, lim]
  );
  return r.rows || [];
}

export async function runBulkEmailSend({
  template,
  mode = 'all',
  plan = 'free',
  excludeAlreadySent = true,
  dataOverride = {},
  sampleData = {},
}) {
  const tpl = String(template || '').trim();
  if (!tpl) throw new Error('template_required');

  const recipients = await listEmailAudience({
    template: tpl,
    mode,
    plan,
    excludeAlreadySent,
  });

  const stats = {
    template: tpl,
    mode,
    plan: mode === 'plan' ? normalizeBroadcastPlan(plan) : null,
    excludeAlreadySent: excludeAlreadySent !== false,
    matchedUsers: recipients.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const row of recipients) {
    const email = String(row.email || '').trim();
    if (!email) continue;

    const firstName = String(row.first_name || '').trim() || inferFirstNameFromEmail(email);
    const data = {
      ...sampleData,
      ...dataOverride,
      email: email.toLowerCase(),
      firstName,
      lastName: String(row.last_name || '').trim(),
    };

    try {
      const result = await sendTemplatedEmail({
        template: tpl,
        recipient: email,
        data,
        tags: ['admin_bulk', String(mode || 'all')],
      });
      if (result?.sent) stats.sent += 1;
      else if (result?.skipped) stats.skipped += 1;
      else {
        stats.failed += 1;
        stats.failures.push({ email, error: result?.error || result?.reason || 'send_failed' });
      }
    } catch (err) {
      stats.failed += 1;
      stats.failures.push({ email, error: err?.message || String(err) });
    }
  }

  const audience = await countEmailAudience({ template: tpl, mode, plan, excludeAlreadySent });
  stats.skippedAlreadySent = audience.skippedAlreadySent;
  stats.totalInScope = audience.totalInScope;

  console.log('[email-broadcast]', stats);
  return stats;
}
