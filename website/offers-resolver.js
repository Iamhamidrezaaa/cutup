(function () {
  if (typeof window === 'undefined') return;

  const PLAN_PRICE_EUR = { starter: 9, pro: 19, business: 49 };
  const PLAN_RANK = { free: 0, starter: 1, pro: 2, business: 3 };
  const CACHE_TTL_MS = 60 * 1000;
  let cache = { at: 0, data: null };

  function normalizePlanName(plan) {
    const p = String(plan || '').trim().toLowerCase();
    if (p === 'advanced') return 'business';
    if (['free', 'starter', 'pro', 'business'].includes(p)) return p;
    return '';
  }

  function apiBase() {
    const base = typeof window.CUTUP_API_BASE === 'string' ? window.CUTUP_API_BASE : '';
    return base.replace(/\/$/, '');
  }

  function getSessionId() {
    try {
      return localStorage.getItem('cutup_session') || '';
    } catch (_e) {
      return '';
    }
  }

  async function waitForAuthReady(maxWaitMs = 3000, stepMs = 250) {
    const started = Date.now();
    while (Date.now() - started <= maxWaitMs) {
      const sid = getSessionId();
      if (sid) return sid;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return '';
  }

  async function fetchJson(path, sessionId) {
    const response = await fetch(`${apiBase()}${path}`, {
      headers: sessionId ? { 'X-Session-Id': sessionId } : undefined
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function resolveUserPlan(sessionId) {
    const { response, data } = await fetchJson(`/api/subscription?action=info&session=${encodeURIComponent(sessionId)}`, sessionId);
    if (!response.ok) return '';
    return normalizePlanName(data?.plan);
  }

  function rank(plan) {
    return PLAN_RANK[String(plan || '').toLowerCase()] ?? 0;
  }

  function inferTargetPlan(offer) {
    return String(
      offer?.targetPlan ||
      (Array.isArray(offer?.applicablePlans) && offer.applicablePlans[0]) ||
      ''
    ).trim().toLowerCase();
  }

  function isEligibleOffer(offer, userPlan) {
    if (!offer || !offer.active) return false;
    if (offer.userOfferStatus && offer.userOfferStatus !== 'active') return false;
    if (offer.expiresAt && new Date(offer.expiresAt).getTime() <= Date.now()) return false;
    const sourcePlan = normalizePlanName(offer.sourcePlan);
    if (sourcePlan && sourcePlan !== userPlan) return false;
    const targetPlan = normalizePlanName(inferTargetPlan(offer));
    if (!targetPlan) return false;
    if (targetPlan === userPlan) return false;
    if (rank(targetPlan) <= rank(userPlan)) return false;
    return true;
  }

  function savingsEur(offer) {
    const targetPlan = inferTargetPlan(offer);
    const base = Number(PLAN_PRICE_EUR[targetPlan] || 0);
    if (!base) return 0;
    if (String(offer.discountType) === 'percentage') return (base * Number(offer.discountValue || 0)) / 100;
    return Math.min(base, Number(offer.discountValue || 0));
  }

  function pickBestOffer(offers, userPlan) {
    const eligible = (offers || []).filter((o) => isEligibleOffer(o, userPlan));
    eligible.sort((a, b) => {
      const aUpgrade = (a.campaignType === 'plan_promotion' || (a.sourcePlan && a.targetPlan)) ? 1 : 0;
      const bUpgrade = (b.campaignType === 'plan_promotion' || (b.sourcePlan && b.targetPlan)) ? 1 : 0;
      if (aUpgrade !== bUpgrade) return bUpgrade - aUpgrade;
      const ds = savingsEur(b) - savingsEur(a);
      if (ds !== 0) return ds;
      const aExp = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bExp = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aExp - bExp;
    });
    return eligible[0] || null;
  }

  function countdownText(expiresAt) {
    if (!expiresAt) return 'No expiry';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const d = Math.floor(ms / (24 * 3600 * 1000));
    const h = Math.floor((ms % (24 * 3600 * 1000)) / (3600 * 1000));
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  }

  function discountLabel(offer) {
    return String(offer.discountType) === 'percentage'
      ? `${Number(offer.discountValue || 0)}%`
      : `€${Number(offer.discountValue || 0).toFixed(2)}`;
  }

  async function resolveActiveUserOffers(options = {}) {
    const force = !!options.force;
    const sessionId = options.sessionId || await waitForAuthReady(Number(options.authWaitMs || 3000));
    if (!sessionId) return { ok: true, sessionId: '', userPlan: '', offers: [], selectedOffer: null };

    if (!force && cache.data && Date.now() - cache.at < CACHE_TTL_MS && cache.data.sessionId === sessionId) return cache.data;

    const userPlan = normalizePlanName(options.userPlan) || await resolveUserPlan(sessionId);
    if (!userPlan) return { ok: false, sessionId, userPlan: '', offers: [], selectedOffer: null };

    const { response, data } = await fetchJson(`/api/offers?plan=${encodeURIComponent(userPlan)}`, sessionId);
    const offers = response.ok && Array.isArray(data?.offers) ? data.offers : [];
    const selectedOffer = pickBestOffer(offers, userPlan);
    const out = { ok: true, sessionId, userPlan, offers, selectedOffer };
    cache = { at: Date.now(), data: out };
    try {
      console.log('[offers-resolver]', {
        httpOk: response.ok,
        userPlan,
        rawOffersCount: offers.length,
        rawOfferCodes: offers.map((o) => o.code).slice(0, 15),
        apiRecommended: data?.recommended?.code || null,
        selectedOffer: selectedOffer ? selectedOffer.code : null
      });
    } catch (_e) {}
    return out;
  }

  function planDisplayName(planKey) {
    const k = normalizePlanName(planKey);
    if (k === 'starter') return 'Starter';
    if (k === 'pro') return 'Pro';
    if (k === 'business') return 'Business';
    return k || 'your next plan';
  }

  function renderGlobalRibbon(resolved) {
    const offer = resolved?.selectedOffer;
    const legacy = document.getElementById('cutupGlobalOfferRibbon');
    if (legacy) legacy.remove();
    const host = document.getElementById('cutupInlineNotify');

    if (!offer) {
      if (host && !host.classList.contains('cutup-inline-notify--warn')) {
        host.hidden = true;
        host.innerHTML = '';
        host.className = 'cutup-inline-notify';
      }
      try {
        console.log('[offers-resolver]', { ribbonRendered: false, reason: 'no_selected_offer' });
      } catch (_e) {}
      return;
    }

    const code = String(offer.code || '').toUpperCase();
    const dismissKey = `cutup_offer_ribbon_dismissed_${code}`;
    let dismissed = 0;
    try {
      dismissed = Number(localStorage.getItem(dismissKey) || 0);
    } catch (_e) {
      dismissed = 0;
    }
    if (dismissed > Date.now()) {
      if (host && !host.classList.contains('cutup-inline-notify--warn')) {
        host.hidden = true;
      }
      try {
        console.log('[offers-resolver]', { ribbonRendered: false, reason: 'dismissed', code });
      } catch (_e) {}
      return;
    }

    if (host && host.classList.contains('cutup-inline-notify--warn') && !host.hidden) {
      return;
    }

    const targetPlan = inferTargetPlan(offer);
    const checkoutHref = `/checkout.html?plan=${encodeURIComponent(targetPlan || 'pro')}&coupon=${encodeURIComponent(code)}`;
    const message =
      `You have a ${discountLabel(offer)} upgrade to ${planDisplayName(targetPlan)}. Use code ${code} at checkout` +
      (offer.expiresAt ? ` · Expires in ${countdownText(offer.expiresAt)}` : '') +
      '.';

    if (host) {
      host.hidden = false;
      host.className = 'cutup-inline-notify cutup-inline-notify--idle';
      host.setAttribute('role', 'region');
      host.innerHTML =
        '<div class="cutup-inline-notify__inner">' +
        `<p class="cutup-inline-notify__text">${message}</p>` +
        `<a class="cutup-inline-notify__cta" href="${checkoutHref}">Upgrade now</a>` +
        '<button type="button" class="cutup-inline-notify__close" aria-label="Dismiss">×</button>' +
        '</div>';
      host.querySelector('.cutup-inline-notify__close')?.addEventListener('click', () => {
        try {
          localStorage.setItem(dismissKey, String(Date.now() + (24 * 3600 * 1000)));
        } catch (_e) {
          /* noop */
        }
        host.hidden = true;
        host.innerHTML = '';
        host.className = 'cutup-inline-notify';
      });
      try {
        console.log('[offers-resolver]', { ribbonRendered: true, code, targetPlan, host: 'cutupInlineNotify' });
      } catch (_e) {}
      return;
    }

    const ribbon = document.createElement('div');
    ribbon.id = 'cutupGlobalOfferRibbon';
    ribbon.className = 'cutup-offer-ribbon';
    ribbon.innerHTML = `
      <div class="cutup-offer-ribbon__content">
        <p>${message}</p>
        <div class="cutup-offer-ribbon__actions">
          <a href="${checkoutHref}">Upgrade now</a>
          <button type="button" id="cutupOfferRibbonDismissBtn" aria-label="Dismiss">×</button>
        </div>
      </div>
    `;
    document.body.appendChild(ribbon);
    document.getElementById('cutupOfferRibbonDismissBtn')?.addEventListener('click', () => {
      try {
        localStorage.setItem(dismissKey, String(Date.now() + (24 * 3600 * 1000)));
      } catch (_e) {
        /* noop */
      }
      ribbon.remove();
    });
    try {
      console.log('[offers-resolver]', { ribbonRendered: true, code, targetPlan, host: 'body-fallback' });
    } catch (_e) {}
  }

  function applyPlanHighlight(rootEl, resolved) {
    if (!rootEl) {
      try {
        console.log('[offers-resolver]', { pricingHighlightRendered: false, reason: 'no_root' });
      } catch (_e) {}
      return false;
    }
    const offer = resolved?.selectedOffer;
    rootEl.querySelectorAll('[data-cutup-offer-highlight]').forEach((el) => el.remove());
    rootEl.querySelectorAll('.cutup-offer-highlight').forEach((el) => el.classList.remove('cutup-offer-highlight'));
    if (!offer) {
      try {
        console.log('[offers-resolver]', { pricingHighlightRendered: false, reason: 'no_selected_offer' });
      } catch (_e) {}
      return false;
    }
    const targetPlan = inferTargetPlan(offer);
    const card = rootEl.querySelector(`[data-upgrade-plan="${targetPlan}"]`)?.closest('.paid-plan-card')
      || rootEl.querySelector(`a[data-cutup-plan="${targetPlan}"]`)?.closest('.pricing-card');
    if (!card) {
      try {
        console.log('[offers-resolver]', { pricingHighlightRendered: false, targetPlan, reason: 'no_matching_card' });
      } catch (_e) {}
      return false;
    }
    card.classList.add('cutup-offer-highlight');
    const badge = document.createElement('div');
    badge.setAttribute('data-cutup-offer-highlight', '1');
    badge.className = 'cutup-offer-highlight-badge';
    badge.textContent = `${discountLabel(offer)} OFF FOR YOU`;
    card.prepend(badge);
    try {
      console.log('[offers-resolver]', { pricingHighlightRendered: true, targetPlan });
    } catch (_e) {}
    return true;
  }

  window.CutupOffersResolver = {
    resolveActiveUserOffers,
    waitForAuthReady,
    normalizePlanName,
    renderGlobalRibbon,
    applyPlanHighlight,
    inferTargetPlan,
    discountLabel,
    countdownText
  };
})();

