/**
 * Admin Payments workspace — YekPay-first, provider-agnostic financial analytics.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { getYekpayStartupState } from './yekpay.js';
import { getPlanDef, resolvePlanKey } from './plans-config.js';
import { getAdminPricingAbMetricsDb } from './billing-repository.js';

const CACHE_TTL_MS = 45_000;
const paymentsCache = new Map();

const PAYMENTS_FROM = `
  FROM payments p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN subscriptions sub ON sub.user_id = u.id
  LEFT JOIN user_profiles up ON up.user_id = u.id
`;

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function resolvePaymentsDateRange({ preset = '30d', startDate = '', endDate = '' } = {}) {
  const to = new Date();
  const p = String(preset || '30d').toLowerCase();
  if (p === 'all') return { from: null, to, preset: 'all' };
  let from = null;
  if (p === 'today') from = startOfUtcDay(to);
  else if (p === '7d') from = new Date(to.getTime() - 7 * 86400000);
  else if (p === '30d') from = new Date(to.getTime() - 30 * 86400000);
  else if (p === '90d') from = new Date(to.getTime() - 90 * 86400000);
  else if (p === 'custom' && startDate) {
    from = new Date(startDate);
    return { from, to: endDate ? new Date(endDate) : to, preset: 'custom' };
  } else from = new Date(to.getTime() - 30 * 86400000);
  return { from, to, preset: p };
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function boolConfigured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function buildPaymentsWhere(opts, params) {
  const where = [];
  const { from, to } = opts.range || {};
  if (from) {
    params.push(from.toISOString());
    where.push(`p.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`p.created_at <= $${params.length}::timestamptz`);
  }
  if (opts.provider && opts.provider !== 'all') {
    params.push(String(opts.provider).toLowerCase());
    where.push(`LOWER(COALESCE(p.provider, p.gateway, 'yekpay')) = $${params.length}`);
  }
  if (opts.status && opts.status !== 'all') {
    params.push(String(opts.status).toLowerCase());
    where.push(`LOWER(p.status) = $${params.length}`);
  }
  if (opts.callbackStatus === 'success') {
    where.push(`p.status = 'success' AND COALESCE(p.ref_id, '') <> ''`);
  } else if (opts.callbackStatus === 'failed') {
    where.push(`p.status IN ('failed', 'canceled')`);
  } else if (opts.callbackStatus === 'pending') {
    where.push(`p.status = 'pending'`);
  }
  if (opts.plan && opts.plan !== 'all') {
    params.push(String(opts.plan).toLowerCase());
    where.push(`LOWER(COALESCE(NULLIF(TRIM(p.plan), ''), p.plan_key, 'free')) = $${params.length}`);
  }
  if (opts.country && opts.country !== 'all') {
    params.push(String(opts.country).toUpperCase().slice(0, 2));
    where.push(`UPPER(COALESCE(up.country, '')) = $${params.length}`);
  }
  if (opts.minAmount != null && opts.minAmount !== '') {
    params.push(Number(opts.minAmount));
    where.push(`COALESCE(p.amount_eur, p.amount, 0) >= $${params.length}`);
  }
  if (opts.maxAmount != null && opts.maxAmount !== '') {
    params.push(Number(opts.maxAmount));
    where.push(`COALESCE(p.amount_eur, p.amount, 0) <= $${params.length}`);
  }
  if (opts.failedOnly) where.push(`p.status IN ('failed', 'canceled')`);
  if (opts.retriesOnly) {
    where.push(
      `(SELECT COUNT(*)::int FROM payment_attempts pa WHERE pa.payment_id = p.id) > 1`
    );
  }
  if (opts.highValueOnly) {
    where.push(`COALESCE(p.amount_eur, p.amount, 0) >= 50`);
  }
  if (opts.sandboxOnly) {
    where.push(`LOWER(COALESCE(p.provider, '')) LIKE '%sandbox%' OR COALESCE(p.discount_code, '') = 'sandbox'`);
  }
  if (opts.liveOnly) {
    where.push(`NOT (LOWER(COALESCE(p.provider, '')) LIKE '%sandbox%')`);
  }
  if (opts.search) {
    params.push(`%${String(opts.search).toLowerCase()}%`);
    const i = params.length;
    where.push(
      `(LOWER(u.email) LIKE $${i} OR LOWER(COALESCE(p.authority, '')) LIKE $${i} OR LOWER(COALESCE(p.ref_id, '')) LIKE $${i} OR LOWER(p.id::text) LIKE $${i})`
    );
  }
  return where.join(' AND ');
}

function paymentsWhere(opts, params) {
  const w = buildPaymentsWhere(opts, params);
  return w ? `WHERE ${w}` : '';
}

function deriveCallbackStatus(row) {
  if (row.status === 'success' && (row.ref_id || row.paid_at)) return 'verified';
  if (row.status === 'pending') return 'pending';
  if (row.status === 'failed' || row.status === 'canceled') return 'failed';
  return row.status || 'unknown';
}

function mapPaymentRow(row) {
  const amountEur = Number(row.amount_eur ?? row.amount ?? 0);
  const attempts = Number(row.attempt_count || 0);
  const riskFlags = [];
  if (attempts >= 3) riskFlags.push('high_retries');
  if (amountEur >= 100) riskFlags.push('high_value');
  if (row.status === 'failed') riskFlags.push('failed');
  const provider = String(row.provider || row.gateway || 'yekpay').toLowerCase();
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    email: row.email,
    plan: resolvePlanKey(row.plan || row.plan_key || 'free'),
    provider,
    gateway: String(row.gateway || provider),
    status: row.status,
    callbackStatus: deriveCallbackStatus(row),
    amountEur,
    amountIrr: row.amount_irr != null ? Number(row.amount_irr) : null,
    currency: row.currency || 'EUR',
    authority: row.authority || row.external_id || '',
    refId: row.ref_id || '',
    externalId: row.external_id || '',
    discountCode: row.discount_code || '',
    country: row.country || '—',
    attemptCount: attempts,
    paidAt: row.paid_at?.toISOString?.() || row.paid_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    customerValueEstimate: Math.round(amountEur * (row.status === 'success' ? 12 : 4) * 100) / 100,
    riskFlags
  };
}

export async function getPaymentInfrastructureDb() {
  const yek = getYekpayStartupState();
  const pool = isBillingDbConfigured() ? getPool() : null;
  let recent = {
    success24h: 0,
    failed24h: 0,
    pendingNow: 0,
    lastSuccessAt: null
  };
  if (pool) {
    try {
      const r = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'success' AND updated_at >= NOW() - INTERVAL '24 hours')::int AS success_24h,
          COUNT(*) FILTER (WHERE status IN ('failed','canceled') AND created_at >= NOW() - INTERVAL '24 hours')::int AS failed_24h,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_now,
          MAX(updated_at) FILTER (WHERE status = 'success') AS last_success
        FROM payments
        WHERE LOWER(COALESCE(provider, gateway, 'yekpay')) = 'yekpay'
      `);
      const row = r.rows[0] || {};
      recent = {
        success24h: Number(row.success_24h || 0),
        failed24h: Number(row.failed_24h || 0),
        pendingNow: Number(row.pending_now || 0),
        lastSuccessAt: row.last_success?.toISOString?.() || row.last_success || null
      };
    } catch (e) {
      console.error('[admin payments] infrastructure stats', e);
    }
  }

  const callbackHealthy =
    yek.merchantConfigured && !yek.configError && recent.failed24h < Math.max(3, recent.success24h * 0.5);

  return {
    primary: {
      provider: 'yekpay',
      label: 'YekPay',
      merchantConfigured: yek.merchantConfigured,
      sandboxMode: yek.sandboxMode,
      environment: yek.sandboxMode ? 'sandbox' : 'production',
      callbackUrl: yek.callbackUrl,
      apiBaseUrl: yek.apiBaseUrl,
      configError: yek.configError,
      eurToIrrConfigured: yek.eurToIrrConfigured,
      eurToIrrRate: yek.eurToIrrRate,
      currency: 'EUR',
      fxStatus: yek.eurToIrrConfigured ? 'configured' : 'missing_rate',
      callbackHealth: callbackHealthy ? 'healthy' : recent.pendingNow > 5 ? 'degraded' : 'attention',
      lastSuccessAt: recent.lastSuccessAt,
      success24h: recent.success24h,
      failed24h: recent.failed24h,
      pendingNow: recent.pendingNow
    },
    optionalGateways: [
      {
        provider: 'stripe',
        label: 'Stripe',
        configured: boolConfigured('STRIPE_SECRET_KEY'),
        webhookConfigured: boolConfigured('STRIPE_WEBHOOK_SECRET'),
        note: 'Optional legacy gateway — not used for new checkouts'
      }
    ]
  };
}

async function queryPaymentsList(pool, opts) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(opts.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const params = [];
  const whereSql = paymentsWhere(opts, params);

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c ${PAYMENTS_FROM} ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.c || 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(pageSize, offset);

  const r = await pool.query(
    `SELECT p.*, u.email, up.country,
            (SELECT COUNT(*)::int FROM payment_attempts pa WHERE pa.payment_id = p.id) AS attempt_count
     ${PAYMENTS_FROM}
     ${whereSql}
     ORDER BY p.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return {
    payments: r.rows.map(mapPaymentRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

async function queryKpis(pool, range, prevRange, opts) {
  const run = async (from, to) => {
    const params = [];
    const whereSql = paymentsWhere({ ...opts, range: { from, to } }, params);
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS gross,
         COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.discount_amount_eur, 0) ELSE 0 END), 0)::numeric AS discounts,
         COUNT(*) FILTER (WHERE p.status = 'success')::int AS successful,
         COUNT(*) FILTER (WHERE p.status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE p.status = 'canceled')::int AS canceled,
         COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE p.status IN ('failed','canceled'))::int AS failed_total,
         COUNT(*)::int AS attempts,
         COALESCE(AVG(CASE WHEN p.status = 'success' THEN COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0) END), 0)::numeric AS avg_order
       ${PAYMENTS_FROM}
       ${whereSql}`,
      params
    );
    return r.rows[0] || {};
  };

  const cur = await run(range.from, range.to);
  const prev = await run(prevRange.from, prevRange.to);

  const gross = Number(cur.gross || 0);
  const prevGross = Number(prev.gross || 0);
  const successful = Number(cur.successful || 0);
  const attempts = Number(cur.attempts || 0);
  const failed = Number(cur.failed || 0);
  const canceled = Number(cur.canceled || 0);
  const pending = Number(cur.pending || 0);

  const mrrRes = await pool.query(`
    SELECT COALESCE(sub.plan, 'free') AS plan, COUNT(*)::int AS c
    FROM subscriptions sub
    WHERE COALESCE(sub.plan, 'free') <> 'free' AND LOWER(sub.status) = 'active'
    GROUP BY 1
  `);
  let mrr = 0;
  for (const row of mrrRes.rows) {
    const def = getPlanDef(row.plan);
    mrr += Number(def?.priceEur?.monthly || 0) * Number(row.c || 0);
  }

  const churnRes = await pool.query(`
    SELECT COUNT(*)::int AS c FROM subscriptions
    WHERE expires_at IS NOT NULL AND expires_at <= NOW() + INTERVAL '7 days'
      AND LOWER(status) = 'active' AND COALESCE(plan, 'free') <> 'free'
  `);

  let recovered = 0;
  try {
    const recoveredRes = await pool.query(
      `SELECT COUNT(DISTINCT p.id)::int AS c
       FROM payments p
       WHERE p.status = 'success'
         AND EXISTS (SELECT 1 FROM payment_attempts pa WHERE pa.payment_id = p.id AND pa.status = 'failed')
         AND EXISTS (SELECT 1 FROM payment_attempts pa2 WHERE pa2.payment_id = p.id AND pa2.status = 'success')`
    );
    recovered = Number(recoveredRes.rows?.[0]?.c || 0);
  } catch {
    recovered = 0;
  }

  const yekSuccess = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'success')::int AS ok,
       COUNT(*)::int AS total
     FROM payments
     WHERE LOWER(COALESCE(provider, gateway, 'yekpay')) = 'yekpay'
       AND created_at >= NOW() - INTERVAL '30 days'`
  );
  const yekRow = yekSuccess.rows[0] || {};
  const yekTotal = Number(yekRow.total || 0);
  const gatewaySuccessRate = yekTotal > 0 ? Math.round((Number(yekRow.ok || 0) / yekTotal) * 1000) / 10 : null;

  return {
    totalRevenueEur: Math.round(gross * 100) / 100,
    netRevenueEur: Math.round((gross - Number(cur.discounts || 0)) * 100) / 100,
    successfulPayments: successful,
    failedPayments: failed,
    canceledPayments: canceled,
    pendingPayments: pending,
    conversionRate: attempts > 0 ? Math.round((successful / attempts) * 1000) / 10 : 0,
    avgOrderValue: Math.round(Number(cur.avg_order || 0) * 100) / 100,
    mrr: Math.round(mrr * 100) / 100,
    refunds: 0,
    activeSubscribers: mrrRes.rows.reduce((s, r) => s + Number(r.c || 0), 0),
    churnRisk: Number(churnRes.rows[0]?.c || 0),
    retryRecovery: recovered,
    gatewaySuccessRate,
    trends: {
      totalRevenueEur: pctChange(gross, prevGross),
      successfulPayments: pctChange(successful, Number(prev.successful || 0)),
      conversionRate: pctChange(
        attempts > 0 ? successful / attempts : 0,
        Number(prev.attempts || 0) > 0 ? Number(prev.successful || 0) / Number(prev.attempts || 0) : 0
      )
    },
    sparkline: []
  };
}

async function queryTimeline(pool, range, opts, grain = 'day') {
  const trunc = grain === 'week' ? 'week' : grain === 'month' ? 'month' : 'day';
  const params = [];
  const whereSql = paymentsWhere({ ...opts, range }, params);
  const r = await pool.query(
    `SELECT date_trunc('${trunc}', p.created_at AT TIME ZONE 'UTC')::date AS bucket,
            COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue,
            COUNT(*) FILTER (WHERE p.status = 'success')::int AS success,
            COUNT(*) FILTER (WHERE p.status IN ('failed','canceled'))::int AS failed
     ${PAYMENTS_FROM}
     ${whereSql}
     GROUP BY 1 ORDER BY 1 ASC`,
    params
  );
  return r.rows.map((row) => ({
    bucket: row.bucket?.toISOString?.()?.slice(0, 10) || String(row.bucket),
    revenue: Number(row.revenue || 0),
    success: Number(row.success || 0),
    failed: Number(row.failed || 0)
  }));
}

async function queryFunnel(pool, range) {
  const params = [];
  const dateFilter = [];
  if (range.from) {
    params.push(range.from.toISOString());
    dateFilter.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (range.to) {
    params.push(range.to.toISOString());
    dateFilter.push(`created_at <= $${params.length}::timestamptz`);
  }
  const df = dateFilter.length ? `AND ${dateFilter.join(' AND ')}` : '';

  const ev = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event = 'pricing_viewed')::int AS pricing_viewed,
       COUNT(*) FILTER (WHERE event = 'upgrade_clicked')::int AS checkout_started,
       COUNT(*) FILTER (WHERE event = 'payment_started')::int AS payment_initiated
     FROM analytics_events
     WHERE 1=1 ${df}`,
    params
  );

  const payParams = [];
  const payWhere = paymentsWhere({ range }, payParams);
  const payOk = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE p.status = 'success')::int AS callback_success,
       COUNT(*)::int AS total
     FROM payments p
     JOIN users u ON u.id = p.user_id
     ${payWhere}`,
    payParams
  );

  const subParams = [];
  const subDate = [];
  if (range.from) {
    subParams.push(range.from.toISOString());
    subDate.push(`s.started_at >= $${subParams.length}::timestamptz`);
  }
  if (range.to) {
    subParams.push(range.to.toISOString());
    subDate.push(`s.started_at <= $${subParams.length}::timestamptz`);
  }
  const subDf = subDate.length ? `AND ${subDate.join(' AND ')}` : '';
  const subActivated = await pool.query(
    `SELECT COUNT(*)::int AS c FROM subscriptions s
     WHERE COALESCE(s.plan, 'free') <> 'free' ${subDf}`,
    subParams
  ).catch(() => ({ rows: [{ c: Number(payOk.rows[0]?.callback_success || 0) }] }));

  const e = ev.rows[0] || {};
  const p = payOk.rows[0] || {};
  return {
    pricingViewed: Number(e.pricing_viewed || 0),
    checkoutStarted: Number(e.checkout_started || 0),
    paymentInitiated: Number(e.payment_initiated || 0),
    callbackSuccess: Number(p.callback_success || 0),
    subscriptionActivated: Number(subActivated.rows[0]?.c || p.callback_success || 0)
  };
}

async function queryBreakdowns(pool, range, opts) {
  const params = [];
  const whereSql = paymentsWhere({ ...opts, range }, params);

  const [byProvider, byPlan, byCountry, heatmap] = await Promise.all([
    pool.query(
      `SELECT LOWER(COALESCE(p.provider, p.gateway, 'yekpay')) AS name,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE p.status = 'success')::int AS success,
              COUNT(*) FILTER (WHERE p.status IN ('failed','canceled'))::int AS failed
       ${PAYMENTS_FROM} ${whereSql}
       GROUP BY 1 ORDER BY total DESC`,
      params
    ),
    pool.query(
      `SELECT LOWER(COALESCE(NULLIF(TRIM(p.plan), ''), p.plan_key, 'free')) AS name,
              COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue,
              COUNT(*)::int AS count
       ${PAYMENTS_FROM} ${whereSql}
       GROUP BY 1 ORDER BY revenue DESC`,
      params
    ),
    pool.query(
      `SELECT UPPER(COALESCE(NULLIF(TRIM(up.country), ''), 'XX')) AS code,
              COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue,
              COUNT(*)::int AS count
       ${PAYMENTS_FROM} ${whereSql}
       GROUP BY 1 ORDER BY revenue DESC LIMIT 12`,
      params
    ),
    pool.query(
      `SELECT EXTRACT(DOW FROM p.created_at AT TIME ZONE 'UTC')::int AS dow,
              EXTRACT(HOUR FROM p.created_at AT TIME ZONE 'UTC')::int AS hour,
              COUNT(*)::int AS count
       ${PAYMENTS_FROM} ${whereSql}
       GROUP BY 1, 2`,
      params
    )
  ]);

  return {
    byProvider: byProvider.rows.map((r) => ({
      name: r.name,
      total: Number(r.total || 0),
      success: Number(r.success || 0),
      failed: Number(r.failed || 0)
    })),
    byPlan: Object.fromEntries(
      byPlan.rows.map((r) => [r.name, { revenue: Number(r.revenue || 0), count: Number(r.count || 0) }])
    ),
    byCountry: byCountry.rows.map((r) => ({
      code: r.code,
      revenue: Number(r.revenue || 0),
      count: Number(r.count || 0)
    })),
    heatmap: heatmap.rows.map((r) => ({
      dow: Number(r.dow || 0),
      hour: Number(r.hour || 0),
      count: Number(r.count || 0)
    }))
  };
}

function buildInsights({ kpis, breakdowns, funnel, infrastructure }) {
  const insights = [];
  const yek = infrastructure?.primary;
  const providers = breakdowns?.byProvider || [];
  const yekP = providers.find((p) => p.name === 'yekpay');
  const countries = breakdowns?.byCountry || [];

  if (yekP && yekP.total > 0) {
    const rate = Math.round((yekP.success / yekP.total) * 1000) / 10;
    insights.push({
      tone: rate >= 85 ? 'ok' : rate >= 70 ? 'neutral' : 'warn',
      text: `YekPay success rate is ${rate}% (${yekP.success}/${yekP.total}) in the selected period.`
    });
  }

  const topCountry = countries.filter((c) => c.code !== 'XX')[0];
  const failedByCountry = countries[0];
  if (topCountry && topCountry.revenue > 0) {
    insights.push({
      tone: 'neutral',
      text: `Top payment geography: ${topCountry.code} with €${topCountry.revenue.toFixed(2)} revenue.`
    });
  }

  if (kpis?.churnRisk > 0) {
    insights.push({
      tone: 'warn',
      text: `${kpis.churnRisk} paid subscription(s) expire within 7 days — churn risk elevated.`
    });
  }

  if (kpis?.retryRecovery > 0) {
    insights.push({
      tone: 'ok',
      text: `${kpis.retryRecovery} payment(s) recovered after a failed attempt.`
    });
  }

  if (funnel?.paymentInitiated > 0 && funnel?.callbackSuccess > 0) {
    const conv = Math.round((funnel.callbackSuccess / funnel.paymentInitiated) * 1000) / 10;
    insights.push({
      tone: conv >= 60 ? 'ok' : 'neutral',
      text: `Checkout conversion (initiated → success): ${conv}% in this period.`
    });
  }

  if (yek?.failed24h > yek?.success24h && yek.failed24h >= 3) {
    insights.push({
      tone: 'warn',
      text: `YekPay had ${yek.failed24h} failed callbacks in the last 24h — review gateway logs.`
    });
  }

  const totalAttempts =
    Number(kpis?.successfulPayments || 0) +
    Number(kpis?.failedPayments || 0) +
    Number(kpis?.canceledPayments || 0) +
    Number(kpis?.pendingPayments || 0);

  if (totalAttempts === 0) {
    insights.unshift({
      tone: 'neutral',
      text: 'No payments recorded yet. YekPay infrastructure is ready — transactions will appear here after the first checkout.'
    });
  } else if (!insights.length) {
    insights.push({
      tone: 'neutral',
      text: 'Payment analytics will become richer as transaction volume grows.'
    });
  }
  return insights.slice(0, 6);
}

function trendRangeFor(range) {
  const to = range.to || new Date();
  const from = range.from || new Date(to.getTime() - 30 * 86400000);
  const span = Math.max(86400000, to.getTime() - from.getTime());
  return {
    from,
    to,
    prevFrom: new Date(from.getTime() - span),
    prevTo: new Date(from.getTime() - 1)
  };
}

export async function getAdminPaymentDetailDb(paymentId) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.*, u.email, up.country,
            (SELECT COUNT(*)::int FROM payment_attempts pa WHERE pa.payment_id = p.id) AS attempt_count
     ${PAYMENTS_FROM}
     WHERE p.id = $1::uuid
     LIMIT 1`,
    [paymentId]
  );
  if (!r.rows.length) return null;
  const payment = mapPaymentRow(r.rows[0]);

  const [attempts, invoices, subscription, auditEvents] = await Promise.all([
    pool.query(
      `SELECT attempt_number, status, error_message, created_at
       FROM payment_attempts WHERE payment_id = $1::uuid ORDER BY attempt_number ASC`,
      [paymentId]
    ),
    pool.query(
      `SELECT id, invoice_number, amount, currency, status, issued_at, pdf_url
       FROM invoices WHERE payment_id = $1::uuid`,
      [paymentId]
    ),
    pool.query(
      `SELECT plan, status, started_at, expires_at, auto_renew
       FROM subscriptions WHERE user_id = $1::uuid LIMIT 1`,
      [r.rows[0].user_id]
    ),
    pool.query(
      `SELECT event_name, event_type, created_at, metadata
       FROM audit_events
       WHERE user_id = $1::uuid
         AND (metadata::text LIKE $2 OR event_name LIKE '%payment%')
       ORDER BY created_at DESC LIMIT 30`,
      [r.rows[0].user_id, `%${paymentId}%`]
    ).catch(() => ({ rows: [] }))
  ]);

  const timeline = [
    { label: 'Payment created', at: payment.createdAt },
    ...attempts.rows.map((a) => ({
      label: `Attempt #${a.attempt_number} (${a.status})`,
      at: a.created_at?.toISOString?.() || a.created_at,
      detail: a.error_message || ''
    })),
    payment.paidAt ? { label: 'Paid / verified', at: payment.paidAt } : null
  ].filter(Boolean);

  return {
    payment,
    attempts: attempts.rows.map((a) => ({
      attemptNumber: Number(a.attempt_number),
      status: a.status,
      errorMessage: a.error_message || '',
      createdAt: a.created_at?.toISOString?.() || a.created_at
    })),
    invoices: invoices.rows.map((i) => ({
      id: String(i.id),
      invoiceNumber: i.invoice_number,
      amount: Number(i.amount || 0),
      currency: i.currency,
      status: i.status,
      issuedAt: i.issued_at?.toISOString?.() || i.issued_at,
      pdfUrl: i.pdf_url || ''
    })),
    subscription: subscription.rows[0]
      ? {
          plan: subscription.rows[0].plan,
          status: subscription.rows[0].status,
          startedAt: subscription.rows[0].started_at?.toISOString?.() || null,
          expiresAt: subscription.rows[0].expires_at?.toISOString?.() || null,
          autoRenew: Boolean(subscription.rows[0].auto_renew)
        }
      : null,
    auditEvents: auditEvents.rows.map((e) => ({
      name: e.event_name,
      type: e.event_type,
      createdAt: e.created_at?.toISOString?.() || e.created_at,
      metadata: e.metadata || {}
    })),
    timeline,
    fx: {
      amountEur: payment.amountEur,
      amountIrr: payment.amountIrr,
      rateConfigured: getYekpayStartupState().eurToIrrConfigured,
      rate: getYekpayStartupState().eurToIrrRate
    }
  };
}

export async function adminPaymentActionDb({ operation, paymentId, note } = {}) {
  if (!isBillingDbConfigured()) return { ok: false, error: 'Database not configured' };
  const pool = getPool();
  const op = String(operation || '').toLowerCase();

  if (op === 'mark_resolved') {
    const r = await pool.query(
      `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid AND status = 'pending' RETURNING id`,
      [paymentId]
    );
    return { ok: r.rowCount > 0, affected: r.rowCount };
  }

  if (op === 'mark_success') {
    const r = await pool.query(
      `UPDATE payments SET status = 'success', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
       WHERE id = $1::uuid RETURNING id`,
      [paymentId]
    );
    return { ok: r.rowCount > 0, affected: r.rowCount };
  }

  return { ok: false, error: 'Unknown operation' };
}

export async function getAdminPaymentsDashboardDb(filters = {}) {
  if (!isBillingDbConfigured()) {
    return {
      payments: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      infrastructure: await getPaymentInfrastructureDb(),
      analytics: null,
      insights: [],
      pricingAb: null,
      debug: { dbConfigured: false }
    };
  }

  const cacheKey = JSON.stringify(filters);
  const hit = paymentsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const range = resolvePaymentsDateRange(filters);
  const tr = trendRangeFor(range);
  const prevRange = { from: tr.prevFrom, to: tr.prevTo };

  const opts = {
    range,
    provider: filters.provider || 'all',
    status: filters.status || 'all',
    callbackStatus: filters.callbackStatus || 'all',
    plan: filters.plan || 'all',
    country: filters.country || 'all',
    search: filters.search || '',
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
    failedOnly: String(filters.failedOnly || '') === '1',
    retriesOnly: String(filters.retriesOnly || '') === '1',
    highValueOnly: String(filters.highValueOnly || '') === '1',
    sandboxOnly: String(filters.sandboxOnly || '') === '1',
    liveOnly: String(filters.liveOnly || '') === '1',
    page: filters.page,
    pageSize: filters.pageSize
  };

  const pool = getPool();
  const infrastructure = await getPaymentInfrastructureDb();

  let list = { payments: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };
  let kpis = null;
  let timeline = [];
  let funnel = null;
  let breakdowns = null;
  let pricingAb = null;

  try {
    list = await queryPaymentsList(pool, opts);
  } catch (e) {
    console.error('[admin payments] list', e);
  }
  try {
    timeline = await queryTimeline(pool, range, opts, filters.grain || 'day');
  } catch (e) {
    console.error('[admin payments] timeline', e);
  }
  try {
    kpis = await queryKpis(pool, range, prevRange, opts);
  } catch (e) {
    console.error('[admin payments] kpis', e);
  }
  try {
    funnel = await queryFunnel(pool, range);
  } catch (e) {
    console.error('[admin payments] funnel', e);
  }
  try {
    breakdowns = await queryBreakdowns(pool, range, opts);
  } catch (e) {
    console.error('[admin payments] breakdowns', e);
  }
  try {
    pricingAb = await getAdminPricingAbMetricsDb();
  } catch (e) {
    console.error('[admin payments] pricing ab', e);
  }

  if (kpis && !kpis.sparkline?.length && timeline.length) {
    kpis.sparkline = timeline.slice(-14).map((s) => ({ day: s.bucket, value: s.revenue }));
  }

  const analytics = kpis || timeline.length || breakdowns ? { kpis, timeline, funnel, breakdowns } : null;
  const insights = buildInsights({ kpis, breakdowns, funnel, infrastructure });

  const data = {
    ...list,
    infrastructure,
    analytics,
    insights,
    pricingAb,
    debug: { preset: range.preset, totalFiltered: list.total }
  };

  paymentsCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
