/**
 * Shared landing + dashboard pricing comparison matrix.
 * Data: CutupPlanPermissions (single source of truth).
 */
(function (global) {
  'use strict';

  var PAID_PLANS = ['starter', 'pro', 'business'];
  var modalEl = null;

  var CRO_COMPARE_ROW_IDS = {
    canTranslate: true,
    mp4VideoExport: true,
    canWatermarkFreeExport: true,
    canUsePremiumStyles: true,
    canUsePriorityQueue: true,
    canUseAdvancedExports: true,
    canUsePrioritySupport: true,
    canUseAgencyFeatures: true
  };

  function buildProHighlight() {
    return (
      '<div class="pricing-pro-highlight">' +
      '<p class="pricing-pro-highlight__title">Most creators choose Pro because it includes:</p>' +
      '<ul class="pricing-pro-highlight__list">' +
      '<li><span class="pricing-pro-highlight__check" aria-hidden="true">✓</span> MP4 video export</li>' +
      '<li><span class="pricing-pro-highlight__check" aria-hidden="true">✓</span> AI Translation</li>' +
      '<li><span class="pricing-pro-highlight__check" aria-hidden="true">✓</span> Premium Caption Styles</li>' +
      '</ul></div>'
    );
  }

  function buildHeadExtras(plan) {
    if (plan === 'pro') return buildProHighlight();
    return '';
  }

  function isCroCompareRow(row) {
    if (!row || !row.id) return false;
    return Boolean(CRO_COMPARE_ROW_IDS[row.id]);
  }

  function rowClassForFeature(row) {
    var classes = [];
    if (row.highlight) classes.push('pricing-compare__highlight-row');
    if (row.upgradeTrigger) classes.push('pricing-compare__upgrade-trigger');
    if (isCroCompareRow(row)) classes.push('pricing-compare__cro-row');
    return classes.length ? ' class="' + classes.join(' ') + '"' : '';
  }

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

  function yesNoCell(on, cro) {
    var cls = on ? 'pricing-compare__yes' : 'pricing-compare__no';
    if (cro && on) cls += ' pricing-compare__yes--cro';
    return on
      ? '<span class="' + cls + '" aria-label="Included">✅</span>'
      : '<span class="' + cls + '" aria-label="Not included">❌</span>';
  }

  function creditsCell(planKey) {
    var n = P().getCreditsLimit ? P().getCreditsLimit(planKey) : 3;
    return (
      '<span class="pricing-compare__export-num">' +
      n +
      '</span><span class="pricing-compare__export-unit">credits/mo</span>'
    );
  }

  function mp4TierCell(planKey) {
    var tiers = P().PLAN_MP4_EXPORT_TIERS || {};
    var label = tiers[planKey];
    if (label == null && P().getMp4ExportTier) label = P().getMp4ExportTier(planKey);
    if (label == null) label = '—';
    var cls = 'pricing-compare__tier';
    if (planKey === 'free') cls += ' pricing-compare__tier--limited';
    else if (planKey === 'starter') cls += ' pricing-compare__tier--basic';
    else if (planKey === 'pro' || planKey === 'business') cls += ' pricing-compare__tier--full';
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }

  function matrixCellValue(plan, row, cro) {
    if (row.type === 'credits') {
      return creditsCell(plan);
    }
    if (row.type === 'mp4_tier') {
      return mp4TierCell(plan);
    }
    var on = P().hasPermission && P().hasPermission(plan, row.id);
    return yesNoCell(on, cro);
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
          '</span>' +
          buildHeadExtras(plan) +
          '</th>'
        );
      })
      .join('');
  }

  function buildBodyRows(currentPlan) {
    var order = P().PLAN_ORDER || ['free', 'starter', 'pro', 'business'];
    var rows = P().MATRIX_FEATURES || [];
    return rows
      .map(function (row) {
        var trClass = rowClassForFeature(row);
        var cro = isCroCompareRow(row);
        var cells = order
          .map(function (plan) {
            var tdAttr = tdColAttr(plan, currentPlan);
            if (row.type === 'credits') {
              return '<td' + tdAttr + ' data-cutup-plan-exports="' + plan + '">' + creditsCell(plan) + '</td>';
            }
            return '<td' + tdAttr + '>' + matrixCellValue(plan, row, cro) + '</td>';
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

  function planCardFeatureBullets(plan) {
    var features =
      (P().getPricingFeatures && P().getPricingFeatures(plan)) ||
      (P().PLAN_PRICING_FEATURES && P().PLAN_PRICING_FEATURES[plan]) ||
      [];
    if (!features.length) return '';
    return (
      '<ul class="pricing-mobile__feat-list">' +
      features
        .map(function (line) {
          return (
            '<li class="pricing-mobile__feat-line">' +
            '<span class="pricing-mobile__feat-check" aria-hidden="true">✓</span>' +
            esc(line) +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function planCardFeaturesList(plan) {
    return planCardFeatureBullets(plan);
  }

  function buildMobilePlanCard(plan, context, currentPlan, subscriptionExpired) {
    var labels = P().PLAN_LABELS || {};
    var prices = P().PLAN_PRICES || {};
    var meta = labels[plan] || {};
    var price = (prices[plan] && prices[plan].display) || '';
    var isPro = plan === 'pro';
    var isCurrent = plan === resolveCurrentPlan(currentPlan);
    var cardClass = 'pricing-mobile__card';
    if (isPro) cardClass += ' pricing-mobile__card--pro';
    if (plan === 'business') cardClass += ' pricing-mobile__card--business';
    if (isCurrent) cardClass += ' pricing-mobile__card--current';

    var badge = isPro ? '<span class="pricing-compare__badge">MOST POPULAR</span>' : '';
    var currentLabel = isCurrent
      ? '<span class="pricing-mobile__current-pill">Current plan</span>'
      : '';

    return (
      '<article class="' +
      cardClass +
      '" data-cutup-mobile-plan="' +
      plan +
      '">' +
      badge +
      currentLabel +
      '<h3 class="pricing-mobile__plan-name">' +
      esc(meta.name || plan) +
      '</h3>' +
      '<p class="pricing-mobile__plan-tag">' +
      esc(meta.tagline || '') +
      '</p>' +
      '<p class="pricing-mobile__price">' +
      esc(price) +
      '</p>' +
      (isPro ? buildProHighlight() : '') +
      planCardFeaturesList(plan) +
      '<div class="pricing-mobile__cta">' +
      ctaForPlan(plan, context, currentPlan, subscriptionExpired) +
      '</div></article>'
    );
  }

  function buildMobileFeatureCompare() {
    var order = P().PLAN_ORDER || ['free', 'starter', 'pro', 'business'];
    var labels = P().PLAN_LABELS || {};
    var rows = (P().MATRIX_FEATURES || [])
      .map(function (row) {
        var cro = isCroCompareRow(row);
        var planCells = order
          .map(function (plan) {
            var shortName = (labels[plan] && labels[plan].name) || plan;
            var val;
            if (row.type === 'credits') {
              val =
                '<span data-cutup-plan-exports="' +
                plan +
                '">' +
                creditsCell(plan) +
                '</span>';
            } else {
              val = matrixCellValue(plan, row, cro);
            }
            var cellClass = 'pricing-mobile__compare-cell';
            if (plan === 'pro') cellClass += ' pricing-mobile__compare-cell--pro';
            return (
              '<div class="' +
              cellClass +
              '">' +
              '<span class="pricing-mobile__compare-plan">' +
              esc(shortName) +
              '</span>' +
              '<span class="pricing-mobile__compare-val">' +
              val +
              '</span></div>'
            );
          })
          .join('');
        var rowClass = 'pricing-mobile__compare-row';
        if (row.highlight) rowClass += ' pricing-mobile__compare-row--highlight';
        if (row.upgradeTrigger) rowClass += ' pricing-mobile__compare-row--upgrade';
        if (cro) rowClass += ' pricing-mobile__compare-row--cro';
        return (
          '<div class="' +
          rowClass +
          '">' +
          '<div class="pricing-mobile__compare-label">' +
          esc(row.label) +
          '</div>' +
          '<div class="pricing-mobile__compare-grid">' +
          planCells +
          '</div></div>'
        );
      })
      .join('');
    return (
      '<details class="pricing-mobile__details">' +
      '<summary class="pricing-mobile__details-summary">Compare all features</summary>' +
      '<div class="pricing-mobile__compare">' +
      rows +
      '</div></details>'
    );
  }

  function buildMobileHtml(context, currentPlan, subscriptionExpired) {
    var order = P().PLAN_ORDER || ['free', 'starter', 'pro', 'business'];
    var cards = order
      .map(function (plan) {
        return buildMobilePlanCard(plan, context, currentPlan, subscriptionExpired);
      })
      .join('');
    return (
      '<div class="pricing-compare-mobile" role="region" aria-label="Plan comparison (mobile)">' +
      '<div class="pricing-mobile__cards">' +
      cards +
      '</div>' +
      buildMobileFeatureCompare() +
      '</div>'
    );
  }

  function buildConversionBanner(context, currentPlan) {
    if (context === 'dashboard') {
      var cur = resolveCurrentPlan(currentPlan);
      var curRank = P().planRank ? P().planRank(cur) : 0;
      var proRank = P().planRank ? P().planRank('pro') : 2;
      if (curRank >= proRank) return '';
    }
    return (
      '<div class="pricing-conversion-banner" role="region" aria-label="Pro plan recommendation">' +
      '<p class="pricing-conversion-banner__text">' +
      'Most creators start with <strong>Pro</strong> because it includes ' +
      'video export, AI translation and premium caption styles.' +
      '</p>' +
      '<a href="javascript:void(0)" class="btn btn-primary pricing-conversion-banner__cta pricing-dashboard-cta" data-cutup-plan="pro">' +
      'Choose Pro' +
      '</a></div>'
    );
  }

  function buildMatrixHtml(context, currentPlan, subscriptionExpired) {
    var ctx = context || 'landing';
    return (
      '<div class="pricing-matrix-root">' +
      buildConversionBanner(ctx, currentPlan) +
      '<div class="pricing-compare-desktop">' +
      '<div class="pricing-compare-wrap" role="region" aria-label="Plan comparison">' +
      '<table class="pricing-compare">' +
      '<thead><tr><th class="pricing-compare__feature-col" scope="col">Feature</th>' +
      buildHead(currentPlan) +
      '</tr></thead>' +
      '<tbody>' +
      buildBodyRows(currentPlan) +
      '</tbody>' +
      buildFoot(ctx, currentPlan, subscriptionExpired) +
      '</table></div></div>' +
      buildMobileHtml(context, currentPlan, subscriptionExpired) +
      '<p class="pricing-compare__footnote">Plans renew monthly in EUR. You will always see the exact total on the checkout page before you confirm.</p></div>'
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
