(function () {
  const API_BASE_URL =
    typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';
  const PAYMENT_RETRY_KEY = 'cutup_payment_retry';

  function displayPlanName(planKey, planNameEn) {
    const k = String(planKey || '').toLowerCase();
    if (k === 'advanced' || k === 'business') return 'Business';
    return planNameEn || planKey || 'Paid';
  }

  function emitPaymentSuccessAnalytics(sessionId) {
    let paidPlan = null;
    try {
      const t = sessionStorage.getItem(PAYMENT_RETRY_KEY);
      if (t) paidPlan = JSON.parse(t).planKey;
    } catch (_e) {
      /* noop */
    }
    try {
      sessionStorage.removeItem(PAYMENT_RETRY_KEY);
    } catch (_e) {
      /* noop */
    }
    try {
      if (typeof window.cutupClearPaywallPaymentFailed === 'function') window.cutupClearPaywallPaymentFailed();
    } catch (_e) {
      /* noop */
    }
    if (typeof sendAnalyticsEvent === 'function') {
      sendAnalyticsEvent('payment_success', { plan: paidPlan, sessionId });
    }
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('payment_success', { plan: paidPlan }, 'business');
    }
    if (typeof window.cutupGrowthRecordPaymentSuccess === 'function') {
      window.cutupGrowthRecordPaymentSuccess();
    }
  }

  function renderOk(planLabel) {
    const el = document.getElementById('cutupPaySuccessRoot');
    if (!el) return;
    el.innerHTML = `
      <div class="cutup-pay-success-icon" aria-hidden="true">✓</div>
      <h1>Payment successful</h1>
      <p>Thank you — your subscription is active. You now have full access for your plan.</p>
      <div class="cutup-pay-success-plan">${escapeHtml(planLabel)}</div>
      <a class="cutup-pay-success-btn" href="/dashboard.html">Go to dashboard</a>
    `;
  }

  function renderWarn(msg, planLabel) {
    const el = document.getElementById('cutupPaySuccessRoot');
    if (!el) return;
    el.innerHTML = `
      <div class="cutup-pay-success-icon" aria-hidden="true">✓</div>
      <h1>Almost there</h1>
      <p>${escapeHtml(msg)}</p>
      <div class="cutup-pay-success-plan">${escapeHtml(planLabel || '—')}</div>
      <a class="cutup-pay-success-btn" href="/dashboard.html">Go to dashboard</a>
    `;
  }

  function renderErr(msg) {
    const el = document.getElementById('cutupPaySuccessRoot');
    if (!el) return;
    el.innerHTML = `
      <h1>Something went wrong</h1>
      <div class="cutup-pay-success-err" role="alert">${escapeHtml(msg)}</div>
      <p style="margin-top:20px"><a class="cutup-pay-success-btn" href="/dashboard.html">Back to dashboard</a></p>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchSubscriptionPlan(sessionId) {
    const r = await fetch(
      `${API_BASE_URL}/api/subscription?action=info&session=${encodeURIComponent(sessionId)}`,
      { headers: { 'X-Session-Id': sessionId } }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { label: 'Your plan' };
    return {
      label: displayPlanName(d.plan, d.planName || d.planNameEn),
    };
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const qSession = params.get('session');
    let sessionId = qSession || localStorage.getItem('cutup_session');
    if (qSession) localStorage.setItem('cutup_session', qSession);

    if (!sessionId) {
      window.location.href = '/';
      return;
    }

    const paymentResult = params.get('payment');
    const paymentId = params.get('payment_id');
    const checkoutSessionId = params.get('checkout_session_id');
    const authority = params.get('authority');
    const hadStripeReturn = paymentResult === 'success' && paymentId && checkoutSessionId;

    let verified = false;
    let pending = false;

    if (hadStripeReturn) {
      try {
        const r = await fetch(`${API_BASE_URL}/api/payment/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
          },
          body: JSON.stringify({
            payment_id: paymentId,
            provider_reference: checkoutSessionId,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && (data.success === true || data.status === 'success')) {
          verified = true;
          emitPaymentSuccessAnalytics(sessionId);
        } else if (data.status === 'pending') {
          pending = true;
        }
      } catch (_e) {
        /* fall through */
      }
    } else if (paymentResult === 'return' && paymentId && authority) {
      try {
        const r = await fetch(`${API_BASE_URL}/api/payment/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
          },
          body: JSON.stringify({
            payment_id: paymentId,
            provider_reference: authority,
            provider: 'yekpay',
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && (data.success === true || data.status === 'success')) {
          verified = true;
          emitPaymentSuccessAnalytics(sessionId);
        }
      } catch (_e) {
        /* noop */
      }
    } else if (paymentResult === 'success' && !hadStripeReturn) {
      emitPaymentSuccessAnalytics(sessionId);
      verified = true;
    }

    const sub = await fetchSubscriptionPlan(sessionId);

    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}?session=${encodeURIComponent(sessionId)}`
    );

    if (verified) {
      renderOk(sub.label);
    } else if (pending) {
      renderWarn(
        'Your bank is still confirming payment. Refresh the dashboard in a minute if your plan has not updated.',
        sub.label
      );
    } else if (paymentResult === 'cancel') {
      window.location.href = `/dashboard.html?session=${encodeURIComponent(sessionId)}`;
    } else if (hadStripeReturn) {
      renderWarn(
        'We could not confirm this payment automatically. If you completed checkout, open your dashboard — your plan usually updates within a minute.',
        sub.label
      );
    } else if (paymentResult === 'success') {
      renderOk(sub.label);
    } else {
      window.location.href = `/dashboard.html?session=${encodeURIComponent(sessionId)}`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
