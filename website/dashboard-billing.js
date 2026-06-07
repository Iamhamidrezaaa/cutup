/**
 * Billing Dashboard — presentation only (Stripe / Linear style).
 */
(function () {
  'use strict';

  var dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  var shortDateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBillingDate(value, short) {
    if (!value) return '—';
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return (short ? shortDateFmt : dateFmt).format(d);
  }

  function formatMoney(amount, currency) {
    var n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    var cur = String(currency || 'EUR').toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
    } catch (_e) {
      return '€' + n.toFixed(2);
    }
  }

  function statusBadgeClass(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'active' || s === 'paid') return 'bd-badge bd-badge--active';
    if (s === 'trialing' || s === 'trial') return 'bd-badge bd-badge--trial';
    if (s === 'pending' || s === 'open') return 'bd-badge bd-badge--pending';
    if (s === 'past_due' || s === 'unpaid' || s === 'failed') return 'bd-badge bd-badge--warn';
    if (s === 'refunded' || s === 'refund') return 'bd-badge bd-badge--refund';
    if (s === 'canceled' || s === 'cancelled') return 'bd-badge bd-badge--danger';
    return 'bd-badge bd-badge--neutral';
  }

  function subscriptionStatusLabel(status, planKey) {
    var s = String(status || '').toLowerCase();
    var plan = String(planKey || 'free').toLowerCase();
    if (plan === 'free') return 'Free';
    if (s === 'active') return 'Active';
    if (s === 'trialing') return 'Trial';
    if (s === 'past_due') return 'Past due';
    if (s === 'unpaid') return 'Unpaid';
    if (s === 'canceled' || s === 'cancelled') return 'Cancelled';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
  }

  function invoiceStatusLabel(status) {
    var s = String(status || 'paid').toLowerCase();
    if (s === 'paid' || s === 'succeeded' || s === 'complete' || s === 'completed') return 'Paid';
    if (s === 'pending' || s === 'open' || s === 'processing') return 'Pending';
    if (s === 'failed' || s === 'past_due' || s === 'unpaid') return 'Failed';
    if (s === 'refunded' || s === 'refund') return 'Refunded';
    return 'Paid';
  }

  function paymentStatusKpi(sub, paymentFailure) {
    if (paymentFailure) {
      return { label: 'Failed', badgeClass: 'bd-badge bd-badge--warn' };
    }
    var planKey = String(sub?.plan || 'free').toLowerCase();
    if (planKey === 'free') {
      return { label: 'No billing', badgeClass: 'bd-badge bd-badge--neutral' };
    }
    var st = String(sub?.status || '').toLowerCase();
    if (st === 'past_due' || st === 'unpaid') {
      return { label: 'Failed', badgeClass: 'bd-badge bd-badge--warn' };
    }
    if (st === 'active' || st === 'trialing') {
      return { label: 'Paid', badgeClass: 'bd-badge bd-badge--active' };
    }
    return { label: subscriptionStatusLabel(st, planKey), badgeClass: statusBadgeClass(st) };
  }

  function monthlyCostLabel(sub) {
    var plan = sub || {};
    if (plan.price && plan.price.display) {
      return String(plan.price.display).replace(' / month', '/mo');
    }
    var planKey = String(plan.plan || 'free').toLowerCase();
    if (planKey === 'free') return '€0';
    return '—';
  }

  function formatPaymentDisplay(pm) {
    if (!pm) return null;
    if (pm.last4) {
      var brand = String(pm.brand || 'Card').replace(/^./, function (c) { return c.toUpperCase(); });
      return brand + ' •••• ' + pm.last4;
    }
    return String(pm.display || '').replace(/ending in /i, '•••• ') || null;
  }

  function progressPct(used, total) {
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  }

  function kpiCard(label, valueHtml, meta) {
    return (
      '<article class="bd-kpi">' +
        '<span class="bd-kpi__label">' + esc(label) + '</span>' +
        '<div class="bd-kpi__value">' + valueHtml + '</div>' +
        (meta ? '<span class="bd-kpi__meta">' + meta + '</span>' : '') +
      '</article>'
    );
  }

  function renderOverviewKpis(sub, usage, paymentFailure) {
    var plan = sub || {};
    var pay = paymentStatusKpi(plan, paymentFailure);
    var planKey = String(plan.plan || 'free').toLowerCase();
    var renewal = formatBillingDate(plan.nextRenewalDate, true);

    return (
      '<section class="bd-block">' +
        '<h2 class="bd-block__title">Billing overview</h2>' +
        '<div class="bd-kpi-grid">' +
          kpiCard('Current plan', esc(plan.planName || plan.plan), '') +
          kpiCard('Monthly cost', esc(monthlyCostLabel(plan)), planKey === 'free' ? '' : 'per billing cycle') +
          kpiCard('Next renewal', esc(renewal), planKey === 'free' ? 'Upgrade for a paid plan' : '') +
          kpiCard('Payment status', '<span class="' + pay.badgeClass + '">' + esc(pay.label) + '</span>', '') +
        '</div>' +
      '</section>'
    );
  }

  function renderUsageSection(usage) {
    var u = usage || {};
    var used = Number(u.usedCredits) || 0;
    var remaining = Number(u.remainingCredits) || 0;
    var total = Number(u.monthlyCredits) || (used + remaining) || 0;
    var pct = progressPct(used, total);

    return (
      '<section class="bd-block bd-block--panel">' +
        '<h2 class="bd-block__title">Usage this cycle</h2>' +
        '<div class="bd-usage-stats">' +
          '<div class="bd-usage-stat"><strong>' + esc(used) + '</strong><span>Credits used</span></div>' +
          '<div class="bd-usage-stat bd-usage-stat--accent"><strong>' + esc(remaining) + '</strong><span>Credits remaining</span></div>' +
          '<div class="bd-usage-stat"><strong>' + esc(total) + '</strong><span>Monthly limit</span></div>' +
        '</div>' +
        '<div class="bd-usage-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="bd-usage-bar__fill" style="width:' + pct + '%"></div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderPaymentSection(pm, canPortal) {
    var hasPm = pm && (pm.display || pm.last4);
    var display = formatPaymentDisplay(pm);
    var exp = pm && pm.expMonth && pm.expYear
      ? String(pm.expMonth).padStart(2, '0') + '/' + pm.expYear
      : null;

    var body = hasPm
      ? '<div class="bd-pay-card">' +
          '<span class="bd-pay-card__icon" aria-hidden="true">💳</span>' +
          '<div class="bd-pay-card__info">' +
            '<strong>' + esc(display) + '</strong>' +
            (exp ? '<span>Expires ' + esc(exp) + '</span>' : '') +
          '</div>' +
          (canPortal ? '<button type="button" class="bd-btn bd-btn--ghost" id="billingUpdatePaymentBtn">Update</button>' : '') +
        '</div>'
      : '<div class="bd-pay-card bd-pay-card--empty">' +
          '<div class="bd-pay-card__info">' +
            '<strong>No payment method added</strong>' +
            '<span>Add a payment method to simplify renewals.</span>' +
          '</div>' +
          (canPortal ? '<button type="button" class="bd-btn" id="billingUpdatePaymentBtn">Add payment method</button>' : '') +
        '</div>';

    return (
      '<section class="bd-block bd-block--panel">' +
        '<h2 class="bd-block__title">Payment method</h2>' +
        body +
      '</section>'
    );
  }

  function renderBillingActivitySection(events) {
    return (
      '<section class="bd-block bd-block--panel bd-block--activity">' +
        '<h2 class="bd-block__title">Billing Activity</h2>' +
        '<p class="bd-block__lead">Payments, renewals, and plan changes.</p>' +
        '<div id="billingActivityFeed" class="af-host"></div>' +
      '</section>'
    );
  }

  function mountBillingActivityFeed(events) {
    var host = document.getElementById('billingActivityFeed');
    if (!host || !window.CutupActivityFeed || typeof window.CutupActivityFeed.renderTimeline !== 'function') return;
    window.CutupActivityFeed.renderTimeline(host, events || [], {
      limit: 10,
      category: 'billing',
      emptyMessage: 'Billing activity appears here after your first payment or plan change.'
    });
  }

  function renderHistorySection(rows) {
    var list = Array.isArray(rows) ? rows : [];

    if (!list.length) {
      return (
        '<section class="bd-block bd-block--panel bd-block--history">' +
          '<h2 class="bd-block__title">Billing history</h2>' +
          '<div class="bd-history-empty">' +
            '<span>No invoices yet</span>' +
            '<p>Invoices appear here after your first successful payment.</p>' +
          '</div>' +
        '</section>'
      );
    }

    var tableRows = list.map(function (row) {
      var st = invoiceStatusLabel(row.status);
      var stKey = String(row.status || 'paid').toLowerCase();
      var invoice = row.downloadUrl && String(row.downloadUrl).startsWith('http')
        ? '<a class="bd-link" href="' + esc(row.downloadUrl) + '" target="_blank" rel="noopener">View</a>'
        : (row.source === 'invoice'
          ? '<button type="button" class="bd-link bd-link--btn" data-invoice-id="' + esc(row.id) + '">View</button>'
          : '<span class="bd-muted">—</span>');
      return (
        '<tr>' +
          '<td data-label="Date">' + esc(formatBillingDate(row.date, true)) + '</td>' +
          '<td data-label="Amount">' + esc(formatMoney(row.amount, row.currency)) + '</td>' +
          '<td data-label="Status"><span class="' + statusBadgeClass(stKey) + '">' + esc(st) + '</span></td>' +
          '<td data-label="Invoice">' + invoice + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<section class="bd-block bd-block--panel bd-block--history">' +
        '<h2 class="bd-block__title">Billing history</h2>' +
        '<div class="bd-table-wrap">' +
          '<table class="bd-table">' +
            '<thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>' +
            '<tbody>' + tableRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>'
    );
  }

  function renderActionsSection(sub, actions) {
    var a = actions || {};
    var s = sub || {};
    var planKey = String(s.plan || 'free').toLowerCase();
    var st = String(s.status || '').toLowerCase();
    var isActive = st === 'active' || st === 'trialing';
    var cancelScheduled = Boolean(s.cancelAtPeriodEnd);
    var canPortal = Boolean(a.canOpenPortal);
    var isPaid = planKey !== 'free';

    var items = [];

    if (canPortal && isPaid) {
      items.push('<button type="button" class="bd-action" id="billingPortalBtn"><span>Manage subscription</span></button>');
    }
    items.push('<button type="button" class="bd-action" id="billingChangePlanBtn"><span>Change plan</span></button>');
    if (canPortal && isPaid && isActive && !cancelScheduled) {
      items.push('<button type="button" class="bd-action bd-action--danger" id="billingCancelBtn"><span>Cancel subscription</span></button>');
    }
    if (canPortal && isPaid && cancelScheduled) {
      items.push('<button type="button" class="bd-action bd-action--primary" id="billingResumeBtn"><span>Resume subscription</span></button>');
    }
    if (canPortal) {
      items.push('<button type="button" class="bd-action" id="billingOpenPortalBtn"><span>Open billing portal</span></button>');
    }

    if (!items.length) return '';

    return (
      '<section class="bd-block bd-block--panel">' +
        '<h2 class="bd-block__title">Subscription actions</h2>' +
        '<div class="bd-actions">' + items.join('') + '</div>' +
      '</section>'
    );
  }

  function renderPaymentFailedAlert() {
    return (
      '<div class="bd-alert bd-alert--error">' +
        '<div class="bd-alert__copy">' +
          '<strong>Payment failed</strong>' +
          '<span>We couldn\'t renew your subscription. Update your payment method to keep your plan active.</span>' +
        '</div>' +
        '<div class="bd-alert__actions">' +
          '<button type="button" class="bd-btn" id="billingRetryPaymentBtn">Retry payment</button>' +
          '<button type="button" class="bd-btn bd-btn--ghost" id="billingUpdateCardBtn">Update payment method</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderExpiringSoonAlert(sub) {
    var planKey = String(sub?.plan || 'free').toLowerCase();
    if (planKey === 'free') return '';
    var st = String(sub?.status || '').toLowerCase();
    if (st !== 'active' && st !== 'trialing') return '';
    if (sub?.cancelAtPeriodEnd) return '';
    var days = daysUntil(sub?.nextRenewalDate || sub?.currentPeriodEnd);
    if (days == null || days > 7 || days < 0) return '';
    return (
      '<div class="bd-alert bd-alert--warn">' +
        '<div class="bd-alert__copy">' +
          '<strong>Subscription expiring soon</strong>' +
          '<span>Renew your subscription to keep access to exports and monthly credits.</span>' +
        '</div>' +
        '<button type="button" class="bd-btn bd-btn--ghost" id="billingExpiringPortalBtn">Manage billing</button>' +
      '</div>'
    );
  }

  function renderRetryWidget() {
    return (
      '<section class="bd-block bd-block--panel">' +
        '<div class="bd-history-empty">' +
          '<span>Billing couldn\'t load</span>' +
          '<p>Please try again in a moment.</p>' +
          '<button type="button" class="bd-btn" id="billingRetryLoadBtn">Try again</button>' +
        '</div>' +
      '</section>'
    );
  }

  function normalizePayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      subscription: raw.subscription || {},
      usage: raw.usage || { monthlyCredits: 0, usedCredits: 0, remainingCredits: 0 },
      paymentMethod: raw.paymentMethod ?? null,
      billingHistory: Array.isArray(raw.billingHistory) ? raw.billingHistory : [],
      upcomingCharge: raw.upcomingCharge ?? null,
      paymentFailure: raw.paymentFailure ?? null,
      actions: raw.actions || {},
      ok: raw.ok !== false
    };
  }

  function bindActions(ctx) {
    var root = ctx.target;
    if (!root) return;

    async function openPortal() {
      if (!ctx.session || !ctx.apiBase) return;
      try {
        var res = await (ctx.apiPost || fetchPortal)(ctx);
        if (res?.url) {
          window.location.href = res.url;
          return;
        }
        ctx.showBanner?.('Please try again in a moment.', 'error');
      } catch (_e) {
        ctx.showBanner?.('Please try again in a moment.', 'error');
      }
    }

    [
      'billingUpdatePaymentBtn',
      'billingUpdateCardBtn',
      'billingCancelBtn',
      'billingResumeBtn',
      'billingPortalBtn',
      'billingOpenPortalBtn',
      'billingExpiringPortalBtn'
    ].forEach(function (id) {
      root.querySelector('#' + id)?.addEventListener('click', openPortal);
    });

    root.querySelector('#billingChangePlanBtn')?.addEventListener('click', function () {
      document.querySelector('.nav-item[data-section="subscription"]')?.click();
    });

    root.querySelectorAll('[data-invoice-id]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-invoice-id');
        if (!id || !ctx.session) return;
        btn.disabled = true;
        try {
          var ir = await fetch(ctx.apiBase + '/api/invoices/' + encodeURIComponent(id), {
            headers: { 'X-Session-Id': ctx.session }
          });
          var inv = await ir.json().catch(function () { return {}; });
          var pdf = inv?.invoice?.pdf_url;
          if (pdf) window.open(pdf, '_blank', 'noopener');
          else ctx.showBanner?.('Invoice is not ready yet.', 'neutral');
        } catch (_e) {
          ctx.showBanner?.('Please try again in a moment.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    root.querySelector('#billingRetryPaymentBtn')?.addEventListener('click', async function () {
      var btn = root.querySelector('#billingRetryPaymentBtn');
      if (btn) btn.disabled = true;
      try {
        if (typeof ctx.onRetryPayment === 'function') await ctx.onRetryPayment();
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  async function fetchPortal(ctx) {
    var r = await fetch(ctx.apiBase + '/api/stripe/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': ctx.session }
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) return { error: true };
    return d;
  }

  function renderBillingCenter(ctx) {
    var target = ctx && ctx.target;
    if (!target) return;

    var loadState = ctx.loadState || (ctx.data ? 'ready' : 'idle');

    if (loadState === 'loading') {
      target.innerHTML =
        '<div class="bd bd--loading">' +
          '<div class="bd-kpi-grid">' +
            new Array(4).fill('<div class="bd-kpi bd-kpi--skeleton"></div>').join('') +
          '</div>' +
        '</div>';
      return;
    }

    var d = normalizePayload(ctx.data);
    if (!d || !d.subscription) {
      target.innerHTML = '<div class="bd">' + renderRetryWidget() + '</div>';
      target.querySelector('#billingRetryLoadBtn')?.addEventListener('click', function () {
        if (typeof ctx.onRetryLoad === 'function') void ctx.onRetryLoad();
      });
      return;
    }

    try {
      var sub = d.subscription;
      var alerts = '';
      if (d.paymentFailure) alerts += renderPaymentFailedAlert();
      else alerts += renderExpiringSoonAlert(sub);

      target.innerHTML =
        '<div class="bd">' +
          alerts +
          renderOverviewKpis(sub, d.usage, d.paymentFailure) +
          renderUsageSection(d.usage) +
          renderPaymentSection(d.paymentMethod, d.actions && d.actions.canOpenPortal) +
          renderBillingActivitySection(ctx.activityFeed) +
          renderHistorySection(d.billingHistory) +
          renderActionsSection(sub, d.actions) +
        '</div>';

      bindActions(ctx);
      mountBillingActivityFeed(ctx.activityFeed);
    } catch (err) {
      console.error('[billing] render failed', err);
      target.innerHTML = '<div class="bd">' + renderRetryWidget() + '</div>';
      target.querySelector('#billingRetryLoadBtn')?.addEventListener('click', function () {
        if (typeof ctx.onRetryLoad === 'function') void ctx.onRetryLoad();
      });
    }
  }

  async function load(ctx) {
    if (!ctx.session || !ctx.apiBase) {
      return { ok: false, status: 0, error: 'no_session', data: null };
    }
    try {
      var url = ctx.apiBase + '/api/subscription?action=billing&session=' + encodeURIComponent(ctx.session);
      var r = await fetch(url, { headers: { 'X-Session-Id': ctx.session } });
      var data = await r.json().catch(function () { return null });
      if (!r.ok) {
        return {
          ok: false,
          status: r.status,
          error: (data && (data.error || data.message)) || ('HTTP ' + r.status),
          data: data && data.subscription ? data : null
        };
      }
      return { ok: true, status: r.status, error: null, data: data };
    } catch (err) {
      return { ok: false, status: 0, error: err?.message || 'network_error', data: null };
    }
  }

  window.CutupBillingDashboard = {
    load: load,
    render: renderBillingCenter,
    renderBillingCenter: renderBillingCenter,
    formatBillingDate: formatBillingDate,
    normalizePayload: normalizePayload
  };
})();
