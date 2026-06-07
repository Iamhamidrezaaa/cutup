/**
 * Billing Dashboard — widget/card architecture (not document layout).
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
    if (s === 'past_due' || s === 'unpaid') return 'bd-badge bd-badge--warn';
    if (s === 'canceled' || s === 'cancelled' || s === 'failed') return 'bd-badge bd-badge--danger';
    return 'bd-badge bd-badge--neutral';
  }

  function statusLabel(status, planKey) {
    var s = String(status || '').toLowerCase();
    var plan = String(planKey || 'free').toLowerCase();
    if (plan === 'free' && s === 'free') return 'Free';
    if (s === 'active') return 'Active';
    if (s === 'trialing') return 'Trial';
    if (s === 'past_due') return 'Past Due';
    if (s === 'unpaid') return 'Unpaid';
    if (s === 'canceled' || s === 'cancelled') return 'Cancelled';
    if (s === 'paid') return 'Paid';
    if (s === 'failed') return 'Failed';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
  }

  function formatPlanPrice(plan) {
    if (plan && plan.price && plan.price.display) {
      return String(plan.price.display).replace(' / month', '/month');
    }
    return '€0';
  }

  function formatPaymentDisplay(pm) {
    if (!pm) return null;
    if (pm.last4) {
      var brand = String(pm.brand || 'Card').replace(/^./, function (c) { return c.toUpperCase(); });
      return brand + ' •••• ' + pm.last4;
    }
    return String(pm.display || '').replace(/ending in /i, '•••• ') || null;
  }

  function humanizeError(err) {
    if (!err) return null;
    var e = String(err).toLowerCase();
    if (e.indexOf('database') >= 0 || e.indexOf('billing_api') >= 0 || e.indexOf('503') >= 0) {
      return 'Limited billing details';
    }
    if (e.indexOf('network') >= 0) return 'Connection issue';
    return 'Some details unavailable';
  }

  function progressPct(used, total) {
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  }

  /** KPI widget — label + huge value + tiny meta only */
  function kpiWidget(label, valueHtml, meta) {
    return (
      '<div class="bd-kpi">' +
        '<span class="bd-kpi__label">' + esc(label) + '</span>' +
        '<div class="bd-kpi__value">' + valueHtml + '</div>' +
        (meta ? '<span class="bd-kpi__meta">' + esc(meta) + '</span>' : '') +
      '</div>'
    );
  }

  function renderKpiGrid(sub, usage) {
    var plan = sub || {};
    var u = usage || {};
    var planKey = String(plan.plan || 'free').toLowerCase();
    var badgeCls = planKey === 'free' ? statusBadgeClass('free') : statusBadgeClass(plan.status);
    var badgeText = planKey === 'free' ? 'Free' : statusLabel(plan.status, plan.plan);
    var renewalMeta = planKey === 'free' ? '—' : 'Auto-renewal';

    return (
      '<div class="bd-kpi-grid">' +
        kpiWidget('Current Plan', esc(plan.planName || plan.plan), formatPlanPrice(plan)) +
        kpiWidget('Credits Remaining', esc(String(u.remainingCredits)), 'credits left') +
        kpiWidget('Status', '<span class="' + badgeCls + '">' + esc(badgeText) + '</span>', '') +
        kpiWidget('Renewal', esc(formatBillingDate(plan.nextRenewalDate)), renewalMeta) +
      '</div>'
    );
  }

  function renderUsagePanel(usage) {
    var u = usage || {};
    var used = Number(u.usedCredits) || 0;
    var remaining = Number(u.remainingCredits) || 0;
    var total = Number(u.monthlyCredits) || (used + remaining) || 0;
    var pct = progressPct(used, total);

    return (
      '<section class="bd-panel bd-panel--usage">' +
        '<div class="bd-panel__toolbar">' +
          '<span class="bd-panel__title">Usage this month</span>' +
          '<span class="bd-panel__chip">' + pct + '%</span>' +
        '</div>' +
        '<div class="bd-usage-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="bd-usage-bar__fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="bd-usage-row">' +
          '<div class="bd-usage-cell"><strong>' + esc(used) + '</strong><span>Used</span></div>' +
          '<div class="bd-usage-cell bd-usage-cell--accent"><strong>' + esc(remaining) + '</strong><span>Remaining</span></div>' +
          '<div class="bd-usage-cell"><strong>' + esc(total) + '</strong><span>Monthly limit</span></div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderUpgrade(planKey, btnId) {
    var k = String(planKey || 'free').toLowerCase();
    if (k !== 'free' && k !== 'starter') return '';
    var PP = window.CutupPlanPermissions;
    if (!PP) return '';
    var next = PP.getNextPlanKey(k);
    var benefits = PP.getUpgradeBenefits(k).slice(0, 5);
    var nextName = next ? PP.displayPlanName(next) : null;
    if (!next || !nextName || !benefits.length) return '';

    return (
      '<div class="bd-upgrade-slot">' +
        '<article class="paid-plan-card featured bd-upgrade-card">' +
          '<div class="paid-plan-header">' +
            '<div class="bd-upgrade-icon" aria-hidden="true">⚡</div>' +
            '<div class="paid-plan-name">Upgrade to ' + esc(nextName) + '</div>' +
            '<div class="bd-upgrade-tagline">Video exports &amp; creator tools</div>' +
          '</div>' +
          '<ul class="plan-features">' +
            benefits.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') +
          '</ul>' +
          '<button type="button" class="plan-btn bd-upgrade-cta" id="' + esc(btnId) + '">Upgrade to ' + esc(nextName) + '</button>' +
        '</article>' +
      '</div>'
    );
  }

  function renderSyncNotice(error) {
    var msg = humanizeError(error);
    if (!msg) return '';
    return (
      '<div class="bd-sync-notice" role="status">' +
        '<span class="bd-sync-notice__dot" aria-hidden="true"></span>' +
        '<span>' + esc(msg) + '</span>' +
      '</div>'
    );
  }

  function renderPaymentAlert(failure) {
    if (!failure) return '';
    return (
      '<section class="bd-panel bd-panel--alert">' +
        '<div class="bd-panel__toolbar">' +
          '<span class="bd-panel__title">Payment failed</span>' +
          '<span class="bd-badge bd-badge--danger">Action required</span>' +
        '</div>' +
        '<div class="bd-alert-actions">' +
          '<button type="button" class="plan-btn plan-btn--sm" id="billingRetryPaymentBtn">Retry</button>' +
          '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost" id="billingUpdateCardBtn">Update card</button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderHistoryPanel(rows) {
    var list = Array.isArray(rows) ? rows : [];

    if (!list.length) {
      return (
        '<section class="bd-panel bd-panel--history">' +
          '<div class="bd-panel__toolbar"><span class="bd-panel__title">Billing history</span></div>' +
          '<div class="bd-empty">' +
            '<div class="bd-empty__art" aria-hidden="true">' +
              '<svg viewBox="0 0 80 80" width="64" height="64" fill="none">' +
                '<rect x="16" y="12" width="48" height="56" rx="6" stroke="currentColor" stroke-width="2.5"/>' +
                '<path d="M28 28h24M28 40h24M28 52h16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
              '</svg>' +
            '</div>' +
            '<strong class="bd-empty__head">No invoices yet</strong>' +
            '<span class="bd-empty__sub">Future payments will appear here</span>' +
          '</div>' +
        '</section>'
      );
    }

    var tableRows = list.map(function (row) {
      var st = String(row.status || 'paid').toLowerCase();
      var download = row.downloadUrl && String(row.downloadUrl).startsWith('http')
        ? '<a class="bd-table-link" href="' + esc(row.downloadUrl) + '" target="_blank" rel="noopener">Download</a>'
        : (row.source === 'invoice'
          ? '<button type="button" class="bd-table-link bd-table-link--btn" data-invoice-id="' + esc(row.id) + '">Download</button>'
          : '<span class="bd-table-muted">—</span>');
      return (
        '<tr>' +
          '<td data-label="Date">' + esc(formatBillingDate(row.date, true)) + '</td>' +
          '<td data-label="Amount">' + esc(formatMoney(row.amount, row.currency)) + '</td>' +
          '<td data-label="Plan">' + esc(row.planName || row.plan) + '</td>' +
          '<td data-label="Status"><span class="' + statusBadgeClass(st) + '">' + esc(statusLabel(st)) + '</span></td>' +
          '<td data-label="Invoice">' + download + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<section class="bd-panel bd-panel--history">' +
        '<div class="bd-panel__toolbar"><span class="bd-panel__title">Billing history</span></div>' +
        '<div class="bd-table-shell">' +
          '<table class="bd-table">' +
            '<thead><tr><th>Date</th><th>Amount</th><th>Plan</th><th>Status</th><th>Invoice</th></tr></thead>' +
            '<tbody>' + tableRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>'
    );
  }

  function renderPaymentPanel(pm, canPortal) {
    var hasPm = pm && (pm.display || pm.last4);
    var display = formatPaymentDisplay(pm);
    var exp = pm && pm.expMonth && pm.expYear
      ? String(pm.expMonth).padStart(2, '0') + '/' + pm.expYear
      : null;
    var btnLabel = hasPm ? 'Update payment method' : 'Add payment method';

    var cardInner = hasPm
      ? '<div class="bd-wallet">' +
          '<span class="bd-wallet__brand">' + esc(display) + '</span>' +
          (exp ? '<span class="bd-wallet__exp">Expires ' + esc(exp) + '</span>' : '') +
        '</div>'
      : '<div class="bd-wallet bd-wallet--empty"><span>No card on file</span></div>';

    var btn = canPortal
      ? '<button type="button" class="plan-btn plan-btn--ghost plan-btn--sm bd-wallet-btn" id="billingUpdatePaymentBtn">' + esc(btnLabel) + '</button>'
      : '';

    return (
      '<section class="bd-panel bd-panel--wallet">' +
        '<div class="bd-panel__toolbar"><span class="bd-panel__title">Payment method</span></div>' +
        cardInner + btn +
      '</section>'
    );
  }

  function renderUpcomingPanel(charge) {
    if (!charge || !charge.date) return '';
    return (
      '<section class="bd-panel bd-panel--upcoming">' +
        '<div class="bd-panel__toolbar"><span class="bd-panel__title">Upcoming charge</span></div>' +
        '<div class="bd-upcoming">' +
          '<strong class="bd-upcoming__amount">' + esc(charge.display || formatMoney(charge.amount, charge.currency)) + '</strong>' +
          '<span class="bd-upcoming__date">' + esc(formatBillingDate(charge.date)) + '</span>' +
        '</div>' +
      '</section>'
    );
  }

  function renderManagePanel(sub, actions) {
    var s = sub || {};
    var a = actions || {};
    var st = String(s.status || '').toLowerCase();
    var isActive = st === 'active' || st === 'trialing';
    var cancelScheduled = Boolean(s.cancelAtPeriodEnd);
    var planKey = String(s.plan || 'free').toLowerCase();

    var actionHtml = '';
    if (cancelScheduled && a.canOpenPortal) {
      actionHtml =
        '<div class="bd-manage-row">' +
          '<span class="bd-manage-meta">Ends ' + esc(formatBillingDate(s.cancelAt || s.currentPeriodEnd)) + '</span>' +
          '<button type="button" class="plan-btn plan-btn--sm" id="billingResumeBtn">Resume</button>' +
        '</div>';
    } else if (isActive && planKey !== 'free' && a.canOpenPortal) {
      actionHtml =
        '<div class="bd-manage-row">' +
          '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost bd-manage-cancel" id="billingCancelBtn">Cancel subscription</button>' +
        '</div>';
    }

    if (!actionHtml && planKey === 'free') return '';

    return (
      '<section class="bd-panel bd-panel--danger">' +
        '<div class="bd-panel__toolbar"><span class="bd-panel__title">Manage subscription</span></div>' +
        (actionHtml || '<span class="bd-manage-meta">Portal unavailable</span>') +
      '</section>'
    );
  }

  function renderErrorWidget(message) {
    return (
      '<section class="bd-panel bd-panel--error">' +
        '<div class="bd-empty">' +
          '<div class="bd-empty__art" aria-hidden="true">⚠️</div>' +
          '<strong class="bd-empty__head">' + esc(message || 'Unable to load billing') + '</strong>' +
          '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost" id="billingRetryLoadBtn">Try again</button>' +
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
      error: raw.error || null,
      ok: raw.ok !== false
    };
  }

  function bindActions(ctx) {
    var root = ctx.target;
    if (!root) return;

    root.querySelector('#billingUpgradePlanBtn')?.addEventListener('click', function () {
      var plan = window.CutupPlanPermissions?.getNextPlanKey?.(ctx.data?.subscription?.plan);
      if (typeof ctx.onUpgrade === 'function') ctx.onUpgrade(plan);
    });

    async function openPortal() {
      if (!ctx.session || !ctx.apiBase) return;
      try {
        var res = await (ctx.apiPost || fetchPortal)(ctx);
        if (res?.error) {
          ctx.showBanner?.(res.error, 'error');
          return;
        }
        if (res?.url) window.location.href = res.url;
      } catch (_e) {
        ctx.showBanner?.('Could not open billing portal.', 'error');
      }
    }

    ['billingUpdatePaymentBtn', 'billingUpdateCardBtn', 'billingCancelBtn', 'billingResumeBtn'].forEach(function (id) {
      root.querySelector('#' + id)?.addEventListener('click', openPortal);
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
          else ctx.showBanner?.('Invoice PDF is not available yet.', 'neutral');
        } catch (_e) {
          ctx.showBanner?.('Could not load invoice.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    root.querySelector('#billingRetryPaymentBtn')?.addEventListener('click', async function () {
      var btn = root.querySelector('#billingRetryPaymentBtn');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      try {
        if (typeof ctx.onRetryPayment === 'function') await ctx.onRetryPayment();
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      }
    });
  }

  async function fetchPortal(ctx) {
    var r = await fetch(ctx.apiBase + '/api/stripe/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': ctx.session }
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) return { error: d.message || d.error || 'Portal unavailable' };
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
      target.innerHTML = '<div class="bd">' + renderErrorWidget('Unable to load billing data') + '</div>';
      target.querySelector('#billingRetryLoadBtn')?.addEventListener('click', function () {
        if (typeof ctx.onRetryLoad === 'function') void ctx.onRetryLoad();
      });
      return;
    }

    try {
      var sub = d.subscription;
      var upcoming = renderUpcomingPanel(d.upcomingCharge);
      var bottomClass = upcoming ? 'bd-duo' : 'bd-duo bd-duo--single';

      target.innerHTML =
        '<div class="bd">' +
          renderSyncNotice(d.error) +
          renderPaymentAlert(d.paymentFailure) +
          renderKpiGrid(sub, d.usage) +
          renderUsagePanel(d.usage) +
          renderUpgrade(sub.plan, 'billingUpgradePlanBtn') +
          renderHistoryPanel(d.billingHistory) +
          '<div class="' + bottomClass + '">' +
            renderPaymentPanel(d.paymentMethod, d.actions && d.actions.canOpenPortal) +
            upcoming +
          '</div>' +
          renderManagePanel(sub, d.actions) +
        '</div>';

      bindActions(ctx);
    } catch (err) {
      console.error('[billing] render failed', err);
      target.innerHTML = '<div class="bd">' + renderErrorWidget('Unable to load billing data') + '</div>';
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
      var data = await r.json().catch(function () { return null; });
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
