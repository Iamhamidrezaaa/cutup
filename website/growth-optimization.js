/**
 * Client-side growth performance + adaptive strategy (no payment/subscription/analytics schema changes).
 */
(function () {
  const PERF_KEY = 'cutup_growth_performance';
  const LAST_STRATEGY_KEY = 'cutup_last_strategy';
  const MIN_TOTAL_SAMPLES = 5;
  const MIN_ARM_SAMPLES = 2;
  const MIN_ARM_SAMPLES_DISCOUNT = 3;

  const DEFAULT_PERF = {
    HARD: { shown: 0, converted: 0 },
    SOFT: { shown: 0, converted: 0 },
    REFERRAL: { shown: 0, converted: 0 },
    DISCOUNT: { shown: 0, converted: 0 },
  };

  function readPerformance() {
    try {
      const raw = localStorage.getItem(PERF_KEY);
      const o = raw ? JSON.parse(raw) : {};
      const out = {};
      ['HARD', 'SOFT', 'REFERRAL', 'DISCOUNT'].forEach(function (k) {
        const x = o[k] && typeof o[k] === 'object' ? o[k] : {};
        out[k] = {
          shown: Math.max(0, Number(x.shown) || 0),
          converted: Math.max(0, Number(x.converted) || 0),
        };
      });
      return out;
    } catch (_e) {
      return JSON.parse(JSON.stringify(DEFAULT_PERF));
    }
  }

  function writePerformance(perf) {
    try {
      localStorage.setItem(PERF_KEY, JSON.stringify(perf));
    } catch (_e) {
      /* noop */
    }
  }

  function growthOptTotalShown() {
    const p = readPerformance();
    return (
      (p.HARD.shown || 0) +
      (p.SOFT.shown || 0) +
      (p.REFERRAL.shown || 0) +
      (p.DISCOUNT.shown || 0)
    );
  }

  function growthOptHasTrustworthySamples() {
    return growthOptTotalShown() >= MIN_TOTAL_SAMPLES;
  }

  function conversionRate(key) {
    const p = readPerformance();
    const o = p[key];
    if (!o || !o.shown) return 0;
    return o.converted / o.shown;
  }

  function getBestStrategy() {
    if (!growthOptHasTrustworthySamples()) return null;
    const perf = readPerformance();
    const tieOrder = ['REFERRAL', 'DISCOUNT', 'HARD', 'SOFT'];
    var best = null;
    var bestR = -1;
    for (var i = 0; i < tieOrder.length; i++) {
      var k = tieOrder[i];
      var sh = perf[k].shown || 0;
      if (sh < 1) continue;
      var r = perf[k].converted / sh;
      if (r > bestR) {
        bestR = r;
        best = k;
      }
    }
    return best;
  }

  function cutupAdaptGrowthState(state) {
    if (!growthOptHasTrustworthySamples()) {
      console.log('[growth-opt] selected strategy:', 'fallback');
      return state;
    }

    const best = getBestStrategy();
    console.log('[growth-opt] selected strategy:', best || 'tie');

    if (state.risk === 'HIGH' && state.incentive === 'DISCOUNT') {
      return state;
    }

    const perf = readPerformance();
    function rate(k) {
      return conversionRate(k);
    }

    var s = {
      intent: state.intent,
      risk: state.risk,
      monetization: state.monetization,
      incentive: state.incentive,
    };

    if (best === 'REFERRAL' && s.incentive === 'DISCOUNT') {
      s.incentive = 'REFERRAL';
      if (s.monetization === 'HARD') s.monetization = 'SOFT';
    }

    if (
      perf.HARD.shown >= MIN_ARM_SAMPLES &&
      perf.SOFT.shown >= MIN_ARM_SAMPLES &&
      rate('HARD') < rate('SOFT') &&
      s.monetization === 'HARD' &&
      s.risk !== 'HIGH'
    ) {
      s.monetization = 'SOFT';
      if (s.incentive === 'NONE' && best === 'REFERRAL') s.incentive = 'REFERRAL';
    }

    var candidates = ['DISCOUNT', 'HARD', 'SOFT', 'REFERRAL'].filter(function (k) {
      return perf[k] && perf[k].shown >= MIN_ARM_SAMPLES_DISCOUNT;
    });
    if (candidates.length >= 2 && s.incentive === 'DISCOUNT' && s.risk !== 'HIGH') {
      var worst = candidates[0];
      for (var j = 1; j < candidates.length; j++) {
        if (rate(candidates[j]) < rate(worst)) worst = candidates[j];
      }
      if (worst === 'DISCOUNT') {
        var slot = Math.floor(Date.now() / 60000) % 2;
        if (slot === 0) {
          s.incentive = 'REFERRAL';
          if (s.monetization === 'HARD') s.monetization = 'SOFT';
        }
      }
    }

    return s;
  }

  function cutupGrowthRecordImpression(state, fired) {
    if (!fired) return;
    var perf = readPerformance();
    var growthPaywall = state.monetization !== 'NONE' || state.incentive === 'DISCOUNT';

    if (fired.paywallVisible && growthPaywall) {
      if (state.monetization === 'HARD') perf.HARD.shown++;
      if (state.monetization === 'SOFT') perf.SOFT.shown++;
    }
    if (fired.discountVisible) perf.DISCOUNT.shown++;
    if (fired.referralFired) perf.REFERRAL.shown++;
    if (fired.softHintFired && state.monetization === 'SOFT' && !fired.paywallVisible) {
      perf.SOFT.shown++;
    }

    var primary = null;
    if (fired.discountVisible) primary = 'DISCOUNT';
    else if (fired.referralFired) primary = 'REFERRAL';
    else if (fired.paywallVisible && growthPaywall && state.monetization === 'HARD') primary = 'HARD';
    else if (
      (fired.paywallVisible && growthPaywall && state.monetization === 'SOFT') ||
      fired.softHintFired
    ) {
      primary = 'SOFT';
    }

    if (primary) {
      try {
        localStorage.setItem(LAST_STRATEGY_KEY, primary);
      } catch (_e2) {
        /* noop */
      }
    }

    writePerformance(perf);
    console.log('[growth-opt] performance', perf);
  }

  function cutupGrowthRecordPaymentSuccess() {
    var perf = readPerformance();
    var k = null;
    try {
      k = localStorage.getItem(LAST_STRATEGY_KEY);
    } catch (_e) {
      k = null;
    }
    if (!k || !perf[k]) return;
    perf[k].converted++;
    writePerformance(perf);
    console.log('[growth-opt] performance', perf);
  }

  if (typeof window !== 'undefined') {
    window.getBestStrategy = getBestStrategy;
    window.cutupAdaptGrowthState = cutupAdaptGrowthState;
    window.cutupGrowthRecordImpression = cutupGrowthRecordImpression;
    window.cutupGrowthRecordPaymentSuccess = cutupGrowthRecordPaymentSuccess;
    window.cutupGrowthOptConversionRate = conversionRate;
    window.cutupGrowthOptReadPerformance = readPerformance;
  }
})();
