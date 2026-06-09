/**
 * Shared landing + dashboard pricing comparison matrix.
 * Data: CutupPlanPermissions (single source of truth).
 */
(function (global) {
  'use strict';

  var PAID_PLANS = ['starter', 'pro', 'business'];
  var modalEl = null;

  function P() {
    return global.CutupPlanPermissions || {};
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function yesNoCell(on) {
    return on
      ? '<span class="pricing-compare__yes" aria-label="Included">✅</span>'
      : '<span class="pricing-compare__no" aria-label="Not included">❌</span>';
  }

  function creditsCell(planKey) {
    var n = P().getCreditsLimit ? P().getCreditsLimit(planKey) : 3;
    return (
      '<span class="pricing-compare__export-num">' +
      n +
      '</span><span class="pricing-compare__export-unit">videos/mo</span>'
    );
  }

  function resolveCurrentPlan(currentPlan) {
    return P().resolvePlanKey ? P().resolvePlanKey(currentPlan || 'free') : 'free';
  }

  function colModifiers(plan, currentPlan) {
    var cur = resolveCurrentPlan(currentPlan);
    var parts = ['pricing-compare__col'];
    if (plan === 'pro') parts.push('pricing-compare__col--pro');
    if (plan === cur) parts.push('pricing-compare__col--current');
    return parts.join(' ');
  }

  function tdColAttr(plan, currentPlan) {
    var parts = [];
    if (plan === 'pro') parts.push('pricing-compare__col--pro');
    if (plan === resolveCurrentPlan(currentPlan)) parts.push('pricing-compare__col--current');
    return parts.length ? ' class="' + parts.join(' ') + '"' : '';
  }

  function footTdClass(plan, currentPlan) {
    var parts = ['pricing-compare__cta-cell'];
    if (plan === 'pro') parts.push('pricing-compare__col--pro');
    if (plan === resolveCurrentPlan(currentPlan)) parts.push('pricing-compare__col--current');
    return parts.join(' ');
  }

  function buildHead(currentPlan) {
    var order = P().PLAN_ORDER || ['free', 'starter', 'pro', 'business'];
    var labels = P().PLAN_LABELS || {};
    var prices = P().PLAN_PRICES || {};
    return order
      .map(function (plan) {
        var meta = labels[plan] || {};
        var price = (prices[plan] && prices[plan].display) || '';
        var badge = plan === 'pro' ? '<span class="pricing-compare__badge">MOST POPULAR</span>' : '';
        return (
          '<th scope="col" class="' +
          colModifiers(plan, currentPlan) +
          '">' +
          badge +
          '<span class="pricing-compare__plan-name">' +
          esc(meta.name || plan) +
          '</span>' +
          '<span class="pricing-compare__plan-tag">' +
          esc(meta.tagline || '') +
          '</span>' +
          '<span class="pricing-compare__price">' +
          esc(price) +
          '</span></th>'
        );
      })
      .join('');
  }

  function buildBodyRows(currentPlan) {
    var order = P().PLAN_ORDER || ['free', 'starter', 'pro', 'business'];
    var rows = P().MATRIX_FEATURES || [];
    return rows
      .map(function (row) {
        var trClass = '';
        if (row.highlight) trClass = ' class="pricing-compare__highlight-row"';
        else if (row.upgradeTrigger) trClass = ' class="pricing-compare__upgrade-trigger"';
        var cells = order
          .map(function (plan) {
            var tdAttr = tdColAttr(plan, currentPlan);
            if (row.type === 'credits') {
              return '<td' + tdAttr + ' data-cutup-plan-exports="' + plan + '">' + creditsCell(plan) + '</td>';
            }
            var on = P().hasPermission && P().hasPermission(plan, row.id);
            return '<td' + tdAttr + '>' + yesNoCell(on) + '</td>';
          })
          .join('');
        return '<tr' + trClass + '><th scope="row">' + esc(row.label) + '</th>' + cells + '</tr>';
      })
      .join('');
  }

  function ctaForPlan(plan, context, currentPlan, subscriptionExpired) {
    var current = P().resolvePlanKey ? P().resolvePlanKey(currentPlan || 'free') : 'free';
    var rank = P().planRank ? P().planRank(plan) : 0;
    var curRank = P().planRank ? P().planRank(current) : 0;
    var expired = Boolean(subscriptionExpired);

    if (plan === 'free') {
      if (context === 'dashboard') {
        if (current === 'free') {
          return '<span class="pricing-compare__current-label">Current plan</span>';
        }
        return '<span class="pricing-compare__muted-label">—</span>';
      }
      return '<a href="/#tool" class="btn btn-secondary">Try free</a>';
    }

    var isCurrent = plan === current;
    var isRenewal = expired && isCurrent;
    var disabled = isRenewal ? false : rank <= curRank;
    var label = isRenewal
      ? 'Renewal'
      : disabled
        ? rank === curRank
          ? 'Current plan'
          : 'Not available'
        : 'Upgrade';
    var cls =
      'btn btn-primary pricing-dashboard-cta' +
      (disabled ? ' disabled-plan-btn' : '') +
      (isRenewal ? ' pricing-dashboard-cta--renewal' : '') +
      (plan === 'pro' && !disabled ? '' : '');
    var aria = disabled ? ' aria-disabled="true" tabindex="-1"' : '';
    var href = disabled ? 'javascript:void(0)' : 'javascript:void(0)';
    return (
      '<a href="' +
      href +
      '" class="' +
      cls +
      '" data-cutup-plan="' +
      plan +
      '"' +
      aria +
      '>' +
      esc(label) +
      '</a>'
    );
  }

  function buildFoot(context, currentPlan, subscriptionExpired) {
    var order = P().PLAN_ORDER || ['free', 'starter', 'pro', 'business'];
    var cells = order
      .map(function (plan) {
        return (
          '<td class="' +
          footTdClass(plan, currentPlan) +
          '">' +
          ctaForPlan(plan, context, currentPlan, subscriptionExpired) +
          '</td>'
        );
      })
      .join('');
    return (
      '<tfoot><tr class="pricing-compare__cta-row">' +
      '<th scope="row" class="pricing-compare__feature-col"></th>' +
      cells +
      '</tr></tfoot>'
    );
  }

  function buildMatrixHtml(context, currentPlan, subscriptionExpired) {
    return (
      '<div class="pricing-compare-wrap" role="region" aria-label="Plan comparison">' +
      '<table class="pricing-compare">' +
      '<thead><tr><th class="pricing-compare__feature-col" scope="col">Feature</th>' +
      buildHead(currentPlan) +
      '</tr></thead>' +
      '<tbody>' +
      buildBodyRows(currentPlan) +
      '</tbody>' +
      buildFoot(context || 'landing', currentPlan, subscriptionExpired) +
      '</table></div>' +
      '<p class="pricing-compare__footnote">Plans renew monthly in EUR. You will always see the exact total on the checkout page before you confirm.</p>'
    );
  }

  function planRank(plan) {
    return P().planRank ? P().planRank(plan) : 0;
  }

  function bindMatrixCtas(root, options) {
    if (!root) return;
    var context = options.context || 'landing';
    var currentPlan = P().resolvePlanKey
      ? P().resolvePlanKey(options.currentPlan || 'free')
      : 'free';
    var onUpgrade = typeof options.onUpgrade === 'function' ? options.onUpgrade : null;
    var subscriptionExpired = Boolean(options.subscriptionExpired);

    root.querySelectorAll('a.pricing-dashboard-cta[data-cutup-plan]').forEach(function (a) {
      var plan = (a.getAttribute('data-cutup-plan') || '').trim().toLowerCase();
      if (!PAID_PLANS.includes(plan)) return;
      var isRenewal = subscriptionExpired && plan === currentPlan;
      var disabled = isRenewal ? false : planRank(plan) <= planRank(currentPlan);
      if (disabled) return;

      if (a.dataset.cutupMatrixBound === '1') return;
      a.dataset.cutupMatrixBound = '1';

      a.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (context === 'dashboard' && onUpgrade) {
          onUpgrade(plan);
          return;
        }
        if (global.CutupPlanCheckout && global.CutupPlanCheckout.handlePlanSelection) {
          void global.CutupPlanCheckout.handlePlanSelection(plan, { source: 'pricing' });
        } else if (typeof global.runPricingUpgradeClick === 'function') {
          void global.runPricingUpgradeClick(plan, 'pricing');
        }
      });
    });
  }

  function mount(container, options) {
    options = options || {};
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return null;
    el.innerHTML = buildMatrixHtml(
      options.context || 'landing',
      options.currentPlan,
      options.subscriptionExpired
    );
    bindMatrixCtas(el, options);
    if (global.CutupPlanDisplay && global.CutupPlanDisplay.hydratePricingCompareTable) {
      global.CutupPlanDisplay.hydratePricingCompareTable();
    }
    return el;
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('is-open');
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cutup-pricing-modal-open');
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'cutupPricingMatrixModal';
    modalEl.className = 'cutup-pricing-modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.setAttribute('aria-label', 'Compare plans');
    modalEl.innerHTML =
      '<div class="cutup-pricing-modal__backdrop" data-cutup-pricing-close></div>' +
      '<div class="cutup-pricing-modal__panel">' +
      '<button type="button" class="cutup-pricing-modal__close" data-cutup-pricing-close aria-label="Close">×</button>' +
      '<div class="cutup-pricing-modal__body" id="cutupPricingMatrixModalBody"></div>' +
      '</div>';
    document.body.appendChild(modalEl);
    modalEl.querySelectorAll('[data-cutup-pricing-close]').forEach(function (btn) {
      btn.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && modalEl.classList.contains('is-open')) closeModal();
    });
    return modalEl;
  }

  function openModal(options) {
    options = options || {};
    var modal = ensureModal();
    var body = modal.querySelector('#cutupPricingMatrixModalBody');
    if (!body) return;
    mount(body, {
      context: 'dashboard',
      currentPlan: options.currentPlan || 'free',
      subscriptionExpired: options.subscriptionExpired,
      onUpgrade: options.onUpgrade
    });
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cutup-pricing-modal-open');
    body.scrollTop = 0;
  }

  global.CutupPricingMatrix = {
    buildMatrixHtml: buildMatrixHtml,
    mount: mount,
    openModal: openModal,
    closeModal: closeModal,
    bindMatrixCtas: bindMatrixCtas
  };
})(typeof window !== 'undefined' ? window : globalThis);
