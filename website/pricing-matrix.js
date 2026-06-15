/**
 * Shared landing + dashboard pricing comparison matrix.
 * Data: CutupPlanPermissions (single source of truth).
 */
(function (global) {
  'use strict';

  var PAID_PLANS = ['starter', 'pro', 'business'];
  var modalEl = null;

  /** Visual-only CRO highlights — maps to existing permission keys, no logic changes */
  var KEY_FEATURE_BADGES = [
    { id: 'canTranslate', icon: '⭐', label: 'AI Translation' },
    { id: 'canExportMp4', icon: '🎬', label: 'MP4 Export' },
    { id: 'canUsePremiumStyles', icon: '✨', label: 'Premium Caption Styles' },
    { id: 'canUseTeams', icon: '👥', label: 'Team Workflow' },
    { id: 'canUsePriorityQueue', icon: '🚀', label: 'Priority Processing' }
  ];

  var CRO_COMPARE_ROW_IDS = {
    canTranslate: true,
    canExportMp4: true,
    canUsePremiumStyles: true,
    canUseCreatorStyles: true,
    canUseTeams: true,
    canUsePriorityQueue: true
  };

  var KEY_SECTION_EXCLUDE = {
    canTranslate: true,
    canExportMp4: true,
    canUsePremiumStyles: true,
    canUseCreatorStyles: true,
    canUseTeams: true,
    canUsePriorityQueue: true
  };

  var GENERIC_SECONDARY_IDS = {
    canUseAiCaptions: true,
    canUseSummary: true,
    canUseBasicTranscript: true
  };

  function planKeyFeatureIds(plan) {
    if (plan === 'pro') return ['canTranslate', 'canExportMp4', 'canUsePremiumStyles'];
    if (plan === 'business') {
      return ['canTranslate', 'canExportMp4', 'canUsePremiumStyles', 'canUseTeams', 'canUsePriorityQueue'];
    }
    if (plan === 'starter') return ['canTranslate'];
    return [];
  }

  function keyBadgeDef(id) {
    for (var i = 0; i < KEY_FEATURE_BADGES.length; i++) {
      if (KEY_FEATURE_BADGES[i].id === id) return KEY_FEATURE_BADGES[i];
    }
    return null;
  }

  function hasKeyFeature(plan, badgeId) {
    if (badgeId === 'canUsePremiumStyles') {
      return (
        (P().hasPermission && P().hasPermission(plan, 'canUsePremiumStyles')) ||
        (P().hasPermission && P().hasPermission(plan, 'canUseCreatorStyles'))
      );
    }
    return P().hasPermission && P().hasPermission(plan, badgeId);
  }

  function buildKeyBadgeHtml(plan, badgeId, compact) {
    var def = keyBadgeDef(badgeId);
    if (!def) return '';
    var on = hasKeyFeature(plan, badgeId);
    var cls = 'pricing-key-badge';
    if (compact) cls += ' pricing-key-badge--compact';
    if (!on) cls += ' pricing-key-badge--locked';
    return (
      '<span class="' +
      cls +
      '">' +
      '<span class="pricing-key-badge__icon" aria-hidden="true">' +
      def.icon +
      '</span>' +
      '<span class="pricing-key-badge__text">' +
      esc(def.label) +
      '</span></span>'
    );
  }

  function buildKeyBadgesRow(plan, compact) {
    var ids = planKeyFeatureIds(plan);
    if (!ids.length) return '';
    return (
      '<div class="pricing-key-badges' +
      (compact ? ' pricing-key-badges--compact' : '') +
      '">' +
      ids
        .map(function (id) {
          return buildKeyBadgeHtml(plan, id, compact);
        })
        .join('') +
      '</div>'
    );
  }

  function buildKeyFeaturesSection(plan, compact) {
    var ids = planKeyFeatureIds(plan);
    if (!ids.length) return '';
    if (plan !== 'pro' && plan !== 'business' && plan !== 'starter') return '';
    var heading = plan === 'starter' ? 'Highlights' : 'Key features';
    var audience =
      plan === 'business'
        ? '<p class="pricing-key__audience">For agencies and teams</p>'
        : '';
    return (
      '<div class="pricing-key">' +
      '<h4 class="pricing-key__heading">' +
      heading +
      '</h4>' +
      buildKeyBadgesRow(plan, compact) +
      audience +
      '</div>'
    );
  }

  function buildPlanTrustLine(plan) {
    if (plan === 'pro') {
      return '<p class="pricing-key__trust">Best for TikTok &amp; YouTube creators</p>';
    }
    return '';
  }

  function buildHeadExtras(plan) {
    var parts = [];
    if (plan === 'pro') {
      parts.push('<span class="pricing-compare__trust-line">Best for TikTok &amp; YouTube creators</span>');
    }
    if (plan === 'business') {
      parts.push('<span class="pricing-compare__audience-line">For agencies and teams</span>');
    }
    if (plan === 'pro' || plan === 'business') {
      parts.push(buildKeyBadgesRow(plan, true));
    }
    return parts.join('');
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
            var on = P().hasPermission && P().hasPermission(plan, row.id);
            return '<td' + tdAttr + '>' + yesNoCell(on, cro) + '</td>';
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

  function planCardCreditsBlock(plan) {
    return (
      '<div class="pricing-mobile__credits">' +
      '<span data-cutup-plan-exports="' +
      plan +
      '">' +
      creditsCell(plan) +
      '</span></div>'
    );
  }

  function planCardSecondaryFeatures(plan) {
    var lines = [];
    (P().MATRIX_FEATURES || []).forEach(function (row) {
      if (row.type === 'credits') return;
      if (KEY_SECTION_EXCLUDE[row.id]) return;
      if (!(P().hasPermission && P().hasPermission(plan, row.id))) return;
      var secondary = GENERIC_SECONDARY_IDS[row.id];
      lines.push(
        '<li class="pricing-mobile__feat-line' +
          (secondary ? ' pricing-mobile__feat-line--secondary' : '') +
          '">' +
          '<span class="pricing-mobile__feat-check" aria-hidden="true">✓</span>' +
          esc(row.label) +
          '</li>'
      );
    });
    if (!lines.length) return '';
    return (
      '<div class="pricing-mobile__also">' +
      '<p class="pricing-mobile__also-label">Also includes</p>' +
      '<ul class="pricing-mobile__feat-list pricing-mobile__feat-list--secondary">' +
      lines.join('') +
      '</ul></div>'
    );
  }

  function planCardFeaturesList(plan) {
    return planCardCreditsBlock(plan) + buildKeyFeaturesSection(plan, false) + planCardSecondaryFeatures(plan);
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
      buildPlanTrustLine(plan) +
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
              val = yesNoCell(P().hasPermission && P().hasPermission(plan, row.id), cro);
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

  function buildMatrixHtml(context, currentPlan, subscriptionExpired) {
    return (
      '<div class="pricing-matrix-root">' +
      '<div class="pricing-compare-desktop">' +
      '<div class="pricing-compare-wrap" role="region" aria-label="Plan comparison">' +
      '<table class="pricing-compare">' +
      '<thead><tr><th class="pricing-compare__feature-col" scope="col">Feature</th>' +
      buildHead(currentPlan) +
      '</tr></thead>' +
      '<tbody>' +
      buildBodyRows(currentPlan) +
      '</tbody>' +
      buildFoot(context || 'landing', currentPlan, subscriptionExpired) +
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
