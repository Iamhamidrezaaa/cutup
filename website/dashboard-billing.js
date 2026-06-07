/**
 * Billing Dashboard — widget architecture (presentation only).
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

    return (
      '<div class="bd-kpi-grid">' +
        kpiWidget('Current Plan', esc(plan.planName || plan.plan), formatPlanPrice(plan)) +
        kpiWidget('Credits Remaining', esc(String(u.remainingCredits)), 'credits left') +
        kpiWidget('Status', '<span class="' + badgeCls + '">' + esc(badgeText) + '</span>', '') +
        kpiWidget('Renewal', esc(formatBillingDate(plan.nextRenewalDate)), planKey === 'free' ? '' : 'Auto-renewal') +
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
      '<section class="bd-panel bd-panel--usage bd-panel--compact">' +
        '<div class="bd-panel__toolbar">' +
          '<span class="bd-panel__title">Monthly usage</span>' +
          '<span class="bd-panel__chip">' + pct + '%</span>' +
        '</div>' +
        '<div class="bd-usage-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="bd-usage-bar__fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="bd-usage-inline">' +
          '<span><strong>' + esc(used) + '</strong> used</span>' +
          '<span><strong>' + esc(remaining) + '</strong> remaining</span>' +
          '<span><strong>' + esc(total) + '</strong> limit</span>' +
        '</div>' +
      '</section>'
    );
  }

  function renderPaymentFailedAlert() {
    return (
      '<section class="bd-panel bd-panel--alert">' +
        '<div class="bd-alert-copy">' +
          '<strong class="bd-alert-title">Payment failed</strong>' +
          '<span class="bd-alert-body">We couldn\'t renew your subscription. Update your payment method to keep your plan active.</span>' +
        '</div>' +
        '<div class="bd-alert-actions">' +
          '<button type="button" class="plan-btn plan-btn--sm" id="billingRetryPaymentBtn">Retry payment</button>' +
          '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost" id="billingUpdateCardBtn">Update payment method</button>' +
        '</div>' +
      '</section>'
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
      '<section class="bd-panel bd-panel--expiring">' +
        '<div class="bd-alert-copy">' +
          '<strong class="bd-alert-title">Subscription expiring soon</strong>' +
          '<span class="bd-alert-body">Renew your subscription to keep access to exports and monthly credits.</span>' +
        '</div>' +
        '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost" id="billingExpiringPortalBtn">Manage billing</button>' +
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
            '<div class="paid-plan-name">' + esc(nextName) + '</div>' +
          '</div>' +
          '<ul class="plan-features bd-upgrade-features--compact">' +
            benefits.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') +
          '</ul>' +
          '<button type="button" class="plan-btn bd-upgrade-cta" id="' + esc(btnId) + '">Upgrade</button>' +
        '</article>' +
      '</div>'
    );
  }

  function renderHistoryPanel(rows) {
    var list = Array.isArray(rows) ? rows : [];

    if (!list.length) {
      return (
        '<section class="bd-panel bd-panel--history bd-panel--history-empty">' +
          '<div class="bd-panel__toolbar"><span class="bd-panel__title">Billing history</span></div>' +
          '<div class="bd-empty bd-empty--compact">' +
            '<div class="bd-empty__art bd-empty__art--sm" aria-hidden="true">' +
              '<svg viewBox="0 0 48 48" width="36" height="36" fill="none">' +
                '<rect x="10" y="8" width="28" height="32" rx="4" stroke="currentColor" stroke-width="2"/>' +
                '<path d="M16 18h16M16 26h16M16 34h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
              '</svg>' +
            '</div>' +
            '<strong class="bd-empty__head">No invoices yet</strong>' +
            '<span class="bd-empty__sub">Your invoices and payment history will appear here after your first successful payment.</span>' +
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

    var inner = hasPm
      ? '<div class="bd-wallet">' +
          '<span class="bd-wallet__brand">' + esc(display) + '</span>' +
          (exp ? '<span class="bd-wallet__exp">Expires ' + esc(exp) + '</span>' : '') +
        '</div>' +
        (canPortal ? '<button type="button" class="plan-btn plan-btn--ghost plan-btn--sm bd-wallet-btn" id="billingUpdatePaymentBtn">Update payment method</button>' : '')
      : '<div class="bd-wallet-empty-state">' +
          '<strong>No payment method added</strong>' +
          '<span>Add a payment method to simplify future renewals.</span>' +
          (canPortal ? '<button type="button" class="plan-btn plan-btn--sm bd-wallet-btn" id="billingUpdatePaymentBtn">Add payment method</button>' : '') +
        '</div>';

    return (
      '<section class="bd-panel bd-panel--wallet">' +
        '<div class="bd-panel__toolbar"><span class="bd-panel__title">Payment method</span></div>' +
        inner +
      '</section>'
    );
  }

  function renderManagePanel(sub, actions) {
    var a = actions || {};
    if (!a.canOpenPortal) return '';

    var s = sub || {};
    var st = String(s.status || '').toLowerCase();
    var isActive = st === 'active' || st === 'trialing';
    var cancelScheduled = Boolean(s.cancelAtPeriodEnd);
    var planKey = String(s.plan || 'free').toLowerCase();
    if (planKey === 'free') return '';

    var buttons = '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost" id="billingPortalBtn">Manage billing</button>' +
      '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost" id="billingUpdateCardBtn">Update card</button>';

    if (cancelScheduled) {
      buttons += '<button type="button" class="plan-btn plan-btn--sm" id="billingResumeBtn">Resume subscription</button>';
    } else if (isActive) {
      buttons += '<button type="button" class="plan-btn plan-btn--sm plan-btn--ghost bd-manage-cancel" id="billingCancelBtn">Cancel subscription</button>';
    }

    return (
      '<section class="bd-panel bd-panel--manage">' +
        '<div class="bd-panel__toolbar"><span class="bd-panel__title">Subscription</span></div>' +
        '<div class="bd-manage-actions">' + buttons + '</div>' +
      '</section>'
    );
  }

  function renderRetryWidget() {
    return (
      '<section class="bd-panel">' +
        '<div class="bd-empty bd-empty--compact">' +
          '<strong class="bd-empty__head">Billing couldn\'t load</strong>' +
          '<span class="bd-empty__sub">Please try again in a moment.</span>' +
          '<button type="button" class="plan-btn plan-btn--sm" id="billingRetryLoadBtn">Try again</button>' +
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

    root.querySelector('#billingUpgradePlanBtn')?.addEventListener('click', function () {
      var plan = window.CutupPlanPermissions?.getNextPlanKey?.(ctx.data?.subscription?.plan);
      if (typeof ctx.onUpgrade === 'function') ctx.onUpgrade(plan);
    });

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

    ['billingUpdatePaymentBtn', 'billingUpdateCardBtn', 'billingCancelBtn', 'billingResumeBtn', 'billingPortalBtn', 'billingExpiringPortalBtn'].forEach(function (id) {
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
      if (btn) { btn.disabled = true; }
      try {
        if (typeof ctx.onRetryPayment === 'function') await ctx.onRetryPayment();
      } finally {
        if (btn) { btn.disabled = false; }
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
          renderKpiGrid(sub, d.usage) +
          renderUsagePanel(d.usage) +
          renderHistoryPanel(d.billingHistory) +
          '<div class="bd-duo">' +
            renderPaymentPanel(d.paymentMethod, d.actions && d.actions.canOpenPortal) +
            renderManagePanel(sub, d.actions) +
          '</div>' +
          renderUpgrade(sub.plan, 'billingUpgradePlanBtn') +
        '</div>';

      bindActions(ctx);
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
