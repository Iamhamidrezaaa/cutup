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

  function formatPlanPrice(plan) {
    if (plan && plan.price && plan.price.display) return plan.price.display;
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

  function upgradeSubtitle(planKey) {
    var k = String(planKey || 'free').toLowerCase();
    if (k === 'free') return 'Unlock translation, exports, and project history.';
    if (k === 'starter') return 'Unlock video exports and creator styles.';
    return 'Unlock more features for your workflow.';
  }

  function statCard(icon, label, valueHtml, desc) {
    return (
      '<div class="billing-stat-card">' +
        '<div class="billing-stat-card__icon" aria-hidden="true">' + icon + '</div>' +
        '<div class="billing-stat-card__body">' +
          '<span class="billing-stat-card__label">' + esc(label) + '</span>' +
          '<div class="billing-stat-card__value">' + valueHtml + '</div>' +
          (desc ? '<span class="billing-stat-card__desc">' + esc(desc) + '</span>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function renderOverviewStats(sub, usage) {
    var plan = sub || {};
    var u = usage || {};
    var planKey = String(plan.plan || 'free').toLowerCase();
    var badgeCls = planKey === 'free' ? statusBadgeClass('free') : statusBadgeClass(plan.status);
    var badgeText = (planKey === 'free' ? 'Free' : statusLabel(plan.status, plan.plan)).toUpperCase();
    var renewalDate = formatBillingDate(plan.nextRenewalDate);
    var renewalDesc = planKey === 'free' ? 'No active subscription' : 'Automatic renewal';

    return (
      '<section class="billing-overview-section">' +
        '<div class="billing-stat-grid">' +
          statCard('💳', 'Current plan', esc(plan.planName || plan.plan), formatPlanPrice(plan)) +
          statCard('🎬', 'Credits remaining', esc(String(u.remainingCredits)), 'credits left') +
          statCard('✓', 'Status', '<span class="' + badgeCls + ' billing-stat-badge">' + esc(badgeText) + '</span>', billingPeriodLabel(plan.billingPeriod) + ' billing') +
          statCard('📅', 'Next renewal', esc(renewalDate), renewalDesc) +
        '</div>' +
      '</section>'
    );
  }

  function renderUsageWidget(usage) {
    var u = usage || {};
    var used = Number(u.usedCredits) || 0;
    var remaining = Number(u.remainingCredits) || 0;
    var total = Number(u.monthlyCredits) || (used + remaining) || 0;
    var pct = progressPct(used, total);

    return (
      '<article class="billing-card billing-card--usage">' +
        '<div class="billing-usage-widget">' +
          '<div class="billing-usage-widget__header">' +
            '<h3 class="billing-section-title">Credits this month</h3>' +
            '<span class="billing-usage-widget__pct">' + pct + '% used</span>' +
          '</div>' +
          '<div class="billing-usage-widget__metrics">' +
            '<div class="billing-usage-metric">' +
              '<span class="billing-usage-metric__value">' + esc(used) + '</span>' +
              '<span class="billing-usage-metric__label">Used</span>' +
            '</div>' +
            '<div class="billing-usage-metric billing-usage-metric--remaining">' +
              '<span class="billing-usage-metric__value">' + esc(remaining) + '</span>' +
              '<span class="billing-usage-metric__label">Remaining</span>' +
            '</div>' +
            '<div class="billing-usage-metric billing-usage-metric--total">' +
              '<span class="billing-usage-metric__value">' + esc(total) + '</span>' +
              '<span class="billing-usage-metric__label">Monthly limit</span>' +
            '</div>' +
          '</div>' +
          '<div class="billing-usage__track" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Credit usage">' +
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
      '<article class="billing-card billing-card--upgrade billing-card--upgrade-featured">' +
        '<div class="billing-upgrade-inner">' +
          '<div class="billing-upgrade-copy">' +
            '<span class="billing-upgrade-eyebrow">Recommended upgrade</span>' +
            '<h2 class="billing-upgrade-title">Upgrade to ' + esc(nextName) + '</h2>' +
            '<p class="billing-upgrade-subtitle">' + esc(upgradeSubtitle(k)) + '</p>' +
            '<ul class="billing-upgrade-features">' +
              benefits.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') +
            '</ul>' +
          '</div>' +
          '<div class="billing-upgrade-cta">' +
            '<button type="button" class="plan-btn billing-upgrade-btn" id="' + esc(onUpgradeId) + '">Upgrade to ' + esc(nextName) + '</button>' +
          '</div>' +
        '</div>' +
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
          '<h2 class="billing-section-title">Billing history</h2>' +
          '<div class="billing-empty billing-empty--illustrated">' +
            '<div class="billing-empty__icon" aria-hidden="true">' +
              '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<rect x="8" y="6" width="32" height="36" rx="4" stroke="currentColor" stroke-width="2"/>' +
                '<path d="M16 16h16M16 24h16M16 32h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
              '</svg>' +
            '</div>' +
            '<p class="billing-empty__title">No invoices yet</p>' +
            '<p class="billing-empty__text">Your future payments and invoices<br>will appear here.</p>' +
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
        '<h2 class="billing-section-title">Billing history</h2>' +
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
    var hasPm = pm && (pm.display || pm.last4);
    var display = formatPaymentDisplay(pm);
    var exp = pm && pm.expMonth && pm.expYear
      ? String(pm.expMonth).padStart(2, '0') + '/' + pm.expYear
      : null;
    var btnLabel = hasPm ? 'Update payment method' : 'Add payment method';
    var btn = canPortal
      ? '<button type="button" class="plan-btn plan-btn--ghost billing-pm-btn" id="billingUpdatePaymentBtn">' + esc(btnLabel) + '</button>'
      : '';

    var body = hasPm
      ? '<div class="billing-pm-card">' +
          '<div class="billing-pm-card__chip" aria-hidden="true">💳</div>' +
          '<div class="billing-pm-card__details">' +
            '<p class="billing-pm__brand">' + esc(display) + '</p>' +
            (exp ? '<p class="billing-pm__exp">Expires ' + esc(exp) + '</p>' : '') +
          '</div>' +
        '</div>'
      : '<div class="billing-pm-empty">' +
          '<span class="billing-pm-empty__icon" aria-hidden="true">💳</span>' +
          '<p class="billing-pm-empty__text">No payment method added yet</p>' +
        '</div>';

    return (
      '<article class="billing-card billing-card--payment">' +
        '<h2 class="billing-section-title">Payment method</h2>' +
        body + btn +
      '</article>'
    );
  }

  function renderUpcoming(charge) {
    if (!charge || !charge.date) return '';
    return (
      '<article class="billing-card billing-card--upcoming">' +
        '<h2 class="billing-section-title">Upcoming charge</h2>' +
        '<p class="billing-upcoming__label">Next payment</p>' +
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
    var planKey = String(s.plan || 'free').toLowerCase();

    var actionsHtml = '';
    if (cancelScheduled) {
      actionsHtml =
        '<p class="billing-manage__end-date">Ends on <strong>' + esc(formatBillingDate(s.cancelAt || s.currentPeriodEnd)) + '</strong></p>' +
        (a.canOpenPortal
          ? '<button type="button" class="plan-btn billing-manage-btn" id="billingResumeBtn">Resume subscription</button>'
          : '');
    } else if (isActive && planKey !== 'free' && a.canOpenPortal) {
      actionsHtml = '<button type="button" class="plan-btn plan-btn--ghost billing-manage-btn billing-manage-btn--danger" id="billingCancelBtn">Cancel subscription</button>';
    } else if (planKey === 'free') {
      actionsHtml = '<p class="billing-manage__hint">Upgrade from the card above to start a paid subscription.</p>';
    } else {
      actionsHtml = '<p class="billing-manage__hint">Subscription changes are managed through the billing portal.</p>';
    }

    return (
      '<article class="billing-card billing-card--manage">' +
        '<div class="billing-manage">' +
          '<div class="billing-manage__copy">' +
            '<h2 class="billing-section-title">Manage subscription</h2>' +
            '<p class="billing-manage__desc">Cancel or resume your subscription. Your plan stays active until the end of the billing period.</p>' +
          '</div>' +
          '<div class="billing-manage__actions">' + actionsHtml + '</div>' +
        '</div>' +
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

      var upcomingHtml = renderUpcoming(d.upcomingCharge);
      var bottomGridClass = upcomingHtml
        ? 'billing-grid billing-grid--pair'
        : 'billing-grid billing-grid--single';

      target.innerHTML =
        '<div class="billing-center">' +
          errorBanner +
          renderPaymentFailure(d.paymentFailure) +
          renderOverviewStats(sub, d.usage) +
          renderUsageWidget(d.usage) +
          renderUpgrade(sub.plan, upgradeId) +
          renderHistory(d.billingHistory) +
          '<div class="' + bottomGridClass + '">' +
            renderPaymentMethod(d.paymentMethod, d.actions && d.actions.canOpenPortal) +
            upcomingHtml +
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
