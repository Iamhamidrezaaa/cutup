/**
 * Coordinates growth UX (pricing paywall, retention hints, referral block).
 * Does not implement billing, subscriptions, or analytics schema changes.
 */
(function () {
  const USAGE_STATS_KEY = 'cutup_usage_stats';
  const RECENT_KEY = 'cutup_recent_activity';
  const PAYMENT_FAILED_KEY = 'cutup_payment_failed_at';
  const REFERRED_KEY = 'cutup_referred_by';
  const INTENT_KEY = 'cutup_intent_score';
  const LAST_ACTION_KEY = 'cutup_last_growth_action';
  const PAYFAIL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const DEDUPE_MS = 2 * 60 * 1000;

  function readUsageStats() {
    try {
      const raw = localStorage.getItem(USAGE_STATS_KEY);
      if (!raw) return { totalUses: 0, useTimestamps: [] };
      const o = JSON.parse(raw);
      return {
        totalUses: Number(o.totalUses) || 0,
        useTimestamps: Array.isArray(o.useTimestamps) ? o.useTimestamps.map(Number).filter(Boolean) : [],
      };
    } catch (_e) {
      return { totalUses: 0, useTimestamps: [] };
    }
  }

  function retentionUsesLast24h(stats) {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return (stats.useTimestamps || []).filter(function (t) {
      return t > dayAgo;
    }).length;
  }

  function readRecentActivity() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_e) {
      return [];
    }
  }

  function isRecentPaymentFailed() {
    try {
      const t = Number(localStorage.getItem(PAYMENT_FAILED_KEY));
      if (!t || Number.isNaN(t)) return false;
      return Date.now() - t < PAYFAIL_WINDOW_MS;
    } catch (_e) {
      return false;
    }
  }

  function readIntentScoreRaw() {
    try {
      const raw = localStorage.getItem(INTENT_KEY);
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
      const j = JSON.parse(raw);
      return Number(j.score);
    } catch (_e) {
      return null;
    }
  }

  function classifyIntentFromScore(score) {
    if (score == null || Number.isNaN(score)) return null;
    var s = score;
    if (s > 1) s = s / 100;
    var highCut = 0.66;
    try {
      if (localStorage.getItem('cutup_pricing_variant') === 'B') highCut = 0.7;
    } catch (_e) {
      /* noop */
    }
    if (s >= highCut) return 'HIGH';
    if (s >= 0.33) return 'MID';
    return 'LOW';
  }

  function deriveIntentFromSignals() {
    const stats = readUsageStats();
    const recent = readRecentActivity();
    const total = stats.totalUses || 0;
    const u24 = retentionUsesLast24h(stats);
    const recentN = recent.length;
    if (total >= 4 || u24 >= 3 || recentN >= 3) return 'HIGH';
    if (total >= 2 || u24 >= 2 || recentN >= 1) return 'MID';
    return 'LOW';
  }

  function isPaidSubscriber() {
    try {
      const p = window.userSubscription && String(window.userSubscription.plan || '').toLowerCase();
      return !!(p && p !== 'free');
    } catch (_e) {
      return false;
    }
  }

  function getGrowthState() {
    const intentScore = readIntentScoreRaw();
    var intent = classifyIntentFromScore(intentScore);
    if (!intent) intent = deriveIntentFromSignals();

    const paymentFailed = isRecentPaymentFailed();
    const referred = !!(localStorage.getItem(REFERRED_KEY) || '').trim();
    const paid = isPaidSubscriber();

    var risk = paymentFailed ? 'HIGH' : 'LOW';
    var monetization = 'NONE';
    var incentive = 'NONE';

    if (paid) {
      return {
        intent: intent,
        risk: paymentFailed ? 'HIGH' : 'LOW',
        monetization: 'NONE',
        incentive: paymentFailed ? 'DISCOUNT' : 'NONE',
      };
    }

    if (paymentFailed) {
      return { intent: intent, risk: 'HIGH', monetization: 'HARD', incentive: 'DISCOUNT' };
    }

    if (referred) {
      incentive = 'REFERRAL';
      if (intent === 'HIGH') monetization = 'HARD';
      else if (intent === 'MID') monetization = 'SOFT';
      else monetization = 'NONE';
      return { intent: intent, risk: risk, monetization: monetization, incentive: incentive };
    }

    if (intent === 'LOW') {
      monetization = 'NONE';
      incentive = 'NONE';
    } else if (intent === 'MID') {
      monetization = 'SOFT';
      incentive = 'REFERRAL';
    } else {
      monetization = 'HARD';
      incentive = 'DISCOUNT';
    }

    return { intent: intent, risk: risk, monetization: monetization, incentive: incentive };
  }

  function canFireGrowthAction(actionKey) {
    try {
      const raw = localStorage.getItem(LAST_ACTION_KEY);
      var map = raw ? JSON.parse(raw) : {};
      if (typeof map !== 'object' || map === null) map = {};
      const last = map[actionKey];
      if (typeof last === 'number' && Date.now() - last < DEDUPE_MS) return false;
      map[actionKey] = Date.now();
      const cutoff = Date.now() - DEDUPE_MS * 3;
      Object.keys(map).forEach(function (k) {
        if (typeof map[k] === 'number' && map[k] < cutoff) delete map[k];
      });
      localStorage.setItem(LAST_ACTION_KEY, JSON.stringify(map));
      return true;
    } catch (_e) {
      return true;
    }
  }

  function setGrowthPaywallFlags(state) {
    if (typeof window === 'undefined') return;
    if (state.monetization === 'NONE') {
      window.cutupGrowthMonetizationOverride = null;
      window.cutupGrowthForceDiscount = false;
      return;
    }
    window.cutupGrowthMonetizationOverride = state.monetization;
    window.cutupGrowthForceDiscount = state.incentive === 'DISCOUNT';
  }

  function clearGrowthPaywallFlags() {
    if (typeof window === 'undefined') return;
    window.cutupGrowthMonetizationOverride = null;
    window.cutupGrowthForceDiscount = false;
  }

  function applyGrowthTriggers(state, reason) {
    console.log('[growth] state:', {
      intent: state.intent,
      risk: state.risk,
      monetization: state.monetization,
      incentive: state.incentive,
    });

    const fired = {
      paywallVisible: false,
      discountVisible: false,
      referralFired: false,
      softHintFired: false,
    };

    const isIndex = !!(typeof document !== 'undefined' && document.getElementById('cutupPricingPaywall'));
    const growthPaywall = state.monetization !== 'NONE' || state.incentive === 'DISCOUNT';

    if (isIndex) {
      setGrowthPaywallFlags(state);
      const paywallKey =
        'paywall:' + state.monetization + ':' + state.incentive + ':' + state.risk + ':' + state.intent;
      if (typeof window.cutupMountIndexPricingPaywall === 'function' && canFireGrowthAction(paywallKey)) {
        window.cutupMountIndexPricingPaywall();
      }
      clearGrowthPaywallFlags();
      const host = document.getElementById('cutupPricingPaywall');
      fired.paywallVisible = !!(
        host &&
        !host.hidden &&
        String(host.innerHTML || '')
          .trim()
          .length > 0
      );
      if (
        fired.paywallVisible &&
        state.incentive === 'DISCOUNT' &&
        typeof window.getHotDiscountCodeForCheckout === 'function' &&
        window.getHotDiscountCodeForCheckout({})
      ) {
        fired.discountVisible = true;
      }
    }

    if (isIndex && state.monetization === 'SOFT') {
      const hint = document.getElementById('retentionUpgradeHint');
      if (hint && canFireGrowthAction('soft_hint')) {
        hint.hidden = false;
        fired.softHintFired = true;
      }
    }

    if (reason === 'after_result' && isIndex) {
      const block = document.getElementById('cutupViralReferralBlock');
      if (state.incentive === 'REFERRAL') {
        if (
          typeof window.cutupShowViralReferralAfterResult === 'function' &&
          canFireGrowthAction('viral_block:' + state.intent + ':' + state.monetization)
        ) {
          window.cutupShowViralReferralAfterResult();
          fired.referralFired = true;
        }
      } else if (block) {
        block.hidden = true;
      }
    }

    const hadGrowthTouch =
      (fired.paywallVisible && growthPaywall) ||
      fired.referralFired ||
      (fired.softHintFired && state.monetization === 'SOFT') ||
      fired.discountVisible;
    if (hadGrowthTouch && typeof window.cutupGrowthRecordImpression === 'function') {
      window.cutupGrowthRecordImpression(state, fired);
    }
  }

  function cutupRunGrowthOrchestrator(reason) {
    if (typeof document === 'undefined') return;
    const staticState = getGrowthState();
    const state =
      typeof window.cutupAdaptGrowthState === 'function'
        ? window.cutupAdaptGrowthState(staticState)
        : staticState;
    applyGrowthTriggers(state, reason);
  }

  if (typeof window !== 'undefined') {
    window.getGrowthState = getGrowthState;
    window.cutupRunGrowthOrchestrator = cutupRunGrowthOrchestrator;
  }

  function boot() {
    if (!document.getElementById('cutupPricingPaywall')) return;
    if (typeof window.cutupInitConversionBanners === 'function') {
      window.cutupInitConversionBanners({ mode: 'landing' });
    }
    cutupRunGrowthOrchestrator('load');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})();
