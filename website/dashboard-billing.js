/**
 * Billing Center UI — subscription overview, history, payment method, actions.
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
    if (s === 'active' || s === 'paid') return 'billing-badge billing-badge--active';
    if (s === 'trialing' || s === 'trial') return 'billing-badge billing-badge--trial';
    if (s === 'past_due' || s === 'unpaid') return 'billing-badge billing-badge--past-due';
    if (s === 'canceled' || s === 'cancelled' || s === 'failed') return 'billing-badge billing-badge--cancelled';
    if (s === 'free') return 'billing-badge billing-badge--neutral';
    return 'billing-badge billing-badge--neutral';
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

  function billingPeriodLabel(period) {
    var p = String(period || 'monthly').toLowerCase();
    if (p === 'annual' || p === 'yearly') return 'Annual';
    return 'Monthly';
  }

  function progressPct(used, total) {
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  }

  function renderOverview(sub, usage) {
    var plan = sub || {};
    var u = usage || {};
    var pct = progressPct(u.usedCredits, u.monthlyCredits);
    var planKey = String(plan.plan || 'free').toLowerCase();
    var badgeCls = planKey === 'free' ? statusBadgeClass('free') : statusBadgeClass(plan.status);
    var badgeText = planKey === 'free' ? 'Free' : statusLabel(plan.status, plan.plan);

    return (
      '<article class="billing-card billing-card--overview">' +
        '<div class="billing-card__head">' +
          '<h2 class="billing-card__title">Subscription overview</h2>' +
          '<span class="' + badgeCls + '">' + esc(badgeText) + '</span>' +
        '</div>' +
        '<p class="billing-overview__label">Current plan</p>' +
        '<p class="billing-overview__plan">' + esc(plan.planName || plan.plan) + '</p>' +
        '<p class="billing-overview__price">' + esc(plan.price && plan.price.display ? plan.price.display : '€0') + '</p>' +
        '<dl class="billing-overview__meta">' +
          '<div><dt>Billing period</dt><dd>' + esc(billingPeriodLabel(plan.billingPeriod)) + '</dd></div>' +
          '<div><dt>Next renewal</dt><dd>' + esc(formatBillingDate(plan.nextRenewalDate)) + '</dd></div>' +
          '<div><dt>Credits</dt><dd>' + esc(u.remainingCredits) + ' / ' + esc(u.monthlyCredits) + ' remaining</dd></div>' +
          '<div><dt>Used this cycle</dt><dd>' + esc(u.usedCredits) + '</dd></div>' +
        '</dl>' +
        '<div class="billing-usage">' +
          '<div class="billing-usage__head">' +
            '<span>Usage this cycle</span>' +
            '<span class="billing-usage__counts">' +
              '<strong>' + esc(u.usedCredits) + ' used</strong> · ' + esc(u.remainingCredits) + ' remaining' +
            '</span>' +
          '</div>' +
          '<div class="billing-usage__track" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
            '<div class="billing-usage__fill" style="width:' + pct + '%"></div>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderUpgrade(planKey, onUpgradeId) {
    var k = String(planKey || 'free').toLowerCase();
    if (k !== 'free' && k !== 'starter') return '';
    var PP = window.CutupPlanPermissions;
    if (!PP) return '';
    var next = PP.getNextPlanKey(k);
    var benefits = PP.getUpgradeBenefits(k);
    var nextName = next ? PP.displayPlanName(next) : null;
    if (!next || !nextName || !benefits.length) return '';

    return (
      '<article class="billing-card billing-card--upgrade">' +
        '<h2 class="billing-card__title">Upgrade to ' + esc(nextName) + '</h2>' +
        '<p class="billing-card__sub">Unlock:</p>' +
        '<ul class="billing-upgrade-list">' +
          benefits.map(function (b) { return '<li>✓ ' + esc(b) + '</li>'; }).join('') +
        '</ul>' +
        '<button type="button" class="plan-btn" id="' + esc(onUpgradeId) + '">Upgrade plan</button>' +
      '</article>'
    );
  }

  function renderPaymentFailure(failure) {
    if (!failure) return '';
    return (
      '<div class="billing-alert billing-alert--danger" role="alert">' +
        '<h3 class="billing-alert__title">Payment failed</h3>' +
        '<p><strong>Reason:</strong> ' + esc(failure.reason || 'Payment could not be processed') + '</p>' +
        '<p>' + esc(failure.message || 'Your subscription may be interrupted.') + '</p>' +
        '<div class="billing-alert__actions">' +
          '<button type="button" class="plan-btn" id="billingRetryPaymentBtn">Retry payment</button>' +
          '<button type="button" class="plan-btn plan-btn--ghost" id="billingUpdateCardBtn">Update card</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderHistory(rows) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      return (
        '<article class="billing-card billing-card--history">' +
          '<h2 class="billing-card__title">Billing history</h2>' +
          '<div class="billing-empty">' +
            '<p class="billing-empty__title">No billing history yet.</p>' +
            '<p class="billing-empty__text">Your first invoice will appear here.</p>' +
          '</div>' +
        '</article>'
      );
    }

    var tableRows = list.map(function (row) {
      var st = String(row.status || 'paid').toLowerCase();
      var download = row.downloadUrl && String(row.downloadUrl).startsWith('http')
        ? '<a class="billing-link" href="' + esc(row.downloadUrl) + '" target="_blank" rel="noopener">Download</a>'
        : (row.source === 'invoice'
          ? '<button type="button" class="billing-link billing-link--btn" data-invoice-id="' + esc(row.id) + '">Download</button>'
          : '<span class="billing-muted">—</span>');
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
      '<article class="billing-card billing-card--history">' +
        '<h2 class="billing-card__title">Billing history</h2>' +
        '<div class="billing-table-wrap">' +
          '<table class="billing-table">' +
            '<thead><tr><th>Date</th><th>Amount</th><th>Plan</th><th>Status</th><th>Invoice</th></tr></thead>' +
            '<tbody>' + tableRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPaymentMethod(pm, canPortal) {
    var body;
    if (pm && pm.display) {
      var exp = pm.expMonth && pm.expYear
        ? String(pm.expMonth).padStart(2, '0') + '/' + pm.expYear
        : null;
      body =
        '<p class="billing-pm__brand">' + esc(pm.display) + '</p>' +
        (exp ? '<p class="billing-pm__exp">Expires ' + esc(exp) + '</p>' : '');
    } else {
      body = '<p class="billing-empty-inline">No payment method on file</p>';
    }
    var btn = canPortal
      ? '<button type="button" class="plan-btn plan-btn--ghost" id="billingUpdatePaymentBtn">Update payment method</button>'
      : '';

    return (
      '<article class="billing-card billing-card--payment">' +
        '<h2 class="billing-card__title">Payment method</h2>' + body + btn +
      '</article>'
    );
  }

  function renderUpcoming(charge) {
    if (!charge || !charge.date) return '';
    return (
      '<article class="billing-card billing-card--upcoming">' +
        '<h2 class="billing-card__title">Upcoming charge</h2>' +
        '<p class="billing-upcoming__amount">' + esc(charge.display || formatMoney(charge.amount, charge.currency)) + '</p>' +
        '<p class="billing-upcoming__date">' + esc(formatBillingDate(charge.date)) + '</p>' +
      '</article>'
    );
  }

  function renderActions(sub, actions) {
    var s = sub || {};
    var a = actions || {};
    var st = String(s.status || '').toLowerCase();
    var isActive = st === 'active' || st === 'trialing';
    var cancelScheduled = Boolean(s.cancelAtPeriodEnd);

    var inner = '';
    if (cancelScheduled) {
      inner =
        '<p class="billing-actions__notice">Subscription will end on:</p>' +
        '<p class="billing-actions__date">' + esc(formatBillingDate(s.cancelAt || s.currentPeriodEnd)) + '</p>' +
        (a.canOpenPortal
          ? '<button type="button" class="plan-btn" id="billingResumeBtn">Resume subscription</button>'
          : '');
    } else if (isActive && s.plan !== 'free') {
      inner =
        (a.canOpenPortal
          ? '<button type="button" class="plan-btn plan-btn--ghost billing-btn--danger" id="billingCancelBtn">Cancel subscription</button>'
          : '') +
        '<p class="billing-actions__hint">Your subscription remains active until the end of the billing period.</p>';
    } else if (s.plan === 'free') {
      inner = '<p class="billing-actions__hint">You are on the free tier. Upgrade anytime from the Plans section or the upgrade card above.</p>';
    } else {
      inner = '<p class="billing-actions__hint">Manage your subscription through the billing portal when available.</p>';
    }

    return (
      '<article class="billing-card billing-card--actions">' +
        '<h2 class="billing-card__title">Subscription management</h2>' + inner +
      '</article>'
    );
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
          if (pdf) {
            window.open(pdf, '_blank', 'noopener');
          } else {
            ctx.showBanner?.('Invoice PDF is not available yet.', 'neutral');
          }
        } catch (_e) {
          ctx.showBanner?.('Could not load invoice.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    root.querySelector('#billingRetryPaymentBtn')?.addEventListener('click', async function () {
      var btn = root.querySelector('#billingRetryPaymentBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Retrying…';
      }
      try {
        if (typeof ctx.onRetryPayment === 'function') {
          await ctx.onRetryPayment();
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Retry payment';
        }
      }
    });
  }

  async function fetchPortal(ctx) {
    var url = ctx.apiBase + '/api/stripe/portal';
    var r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': ctx.session
      }
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) return { error: d.message || d.error || 'Portal unavailable' };
    return d;
  }

  function renderErrorCard(message, detail) {
    return (
      '<article class="billing-card billing-card--error">' +
        '<h2 class="billing-card__title">Unable to load billing data</h2>' +
        '<p class="billing-empty__text">' + esc(message || 'Please refresh the page or try again in a moment.') + '</p>' +
        (detail ? '<p class="billing-empty__text billing-error-detail">' + esc(detail) + '</p>' : '') +
        '<button type="button" class="plan-btn plan-btn--ghost" id="billingRetryLoadBtn">Try again</button>' +
      '</article>'
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

  function renderBillingCenter(ctx) {
    var target = ctx && ctx.target;
    if (!target) return;

    var loadState = ctx.loadState || (ctx.data ? 'ready' : 'idle');
    console.log('[billing]', {
      loadState: loadState,
      payload: ctx.data,
      error: ctx.loadError || null
    });

    if (loadState === 'loading') {
      target.innerHTML =
        '<div class="billing-center billing-center--loading">' +
          '<p class="dashboard-muted-loading">Loading billing details…</p>' +
        '</div>';
      return;
    }

    var d = normalizePayload(ctx.data);
    if (!d || !d.subscription) {
      target.innerHTML =
        '<div class="billing-center">' + renderErrorCard(ctx.loadError || 'Unable to load billing data') + '</div>';
      target.querySelector('#billingRetryLoadBtn')?.addEventListener('click', function () {
        if (typeof ctx.onRetryLoad === 'function') void ctx.onRetryLoad();
      });
      return;
    }

    try {
      var sub = d.subscription || {};
      var upgradeId = 'billingUpgradePlanBtn';
      var errorBanner = (!d.ok || d.error)
        ? '<div class="billing-alert billing-alert--warn" role="status">' +
            '<p>Some billing details could not be loaded. Showing available information.</p>' +
            (d.error ? '<p class="billing-error-detail">' + esc(d.error) + '</p>' : '') +
          '</div>'
        : '';

      target.innerHTML =
        '<div class="billing-center">' +
          errorBanner +
          renderPaymentFailure(d.paymentFailure) +
          '<div class="billing-grid billing-grid--top">' +
            renderOverview(sub, d.usage) +
            renderUpgrade(sub.plan, upgradeId) +
          '</div>' +
          renderHistory(d.billingHistory) +
          '<div class="billing-grid billing-grid--bottom">' +
            renderPaymentMethod(d.paymentMethod, d.actions && d.actions.canOpenPortal) +
            renderUpcoming(d.upcomingCharge) +
          '</div>' +
          renderActions(sub, d.actions) +
        '</div>';

      bindActions(ctx);
    } catch (err) {
      console.error('[billing] render failed', err);
      target.innerHTML =
        '<div class="billing-center">' +
          renderErrorCard('Unable to load billing data', err && err.message ? err.message : null) +
        '</div>';
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
      console.log('[billing] fetch', { status: r.status, ok: r.ok, body: data });
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
      console.error('[billing] fetch error', err);
      return { ok: false, status: 0, error: err && err.message ? err.message : 'network_error', data: null };
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
