(function () {
  const API_BASE_URL =
    typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';
  const PAYMENT_RETRY_KEY = 'cutup_payment_retry';
  const VALID_PLANS = new Set(['starter', 'pro', 'business', 'advanced']);

  const PLAN_LABEL = {
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business',
    advanced: 'Business',
  };

  const PLAN_EUR = {
    starter: 9,
    pro: 19,
    business: 49,
    advanced: 49,
  };

  function inferPaymentProvider() {
    if (typeof window !== 'undefined' && window.CUTUP_PAYMENT_PROVIDER) {
      return window.CUTUP_PAYMENT_PROVIDER === 'yekpay' ? 'yekpay' : 'stripe';
    }
    try {
      const lang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
      if (lang.startsWith('fa')) return 'yekpay';
    } catch (_e) {
      /* noop */
    }
    return 'stripe';
  }

  function rememberPaymentRetryContext(planKey, provider) {
    try {
      sessionStorage.setItem(PAYMENT_RETRY_KEY, JSON.stringify({ planKey, provider }));
    } catch (_e) {
      /* noop */
    }
  }

  function getHotDiscountCodeForCheckout() {
    try {
      if (typeof window.getHotDiscountCodeForCheckout === 'function') {
        return window.getHotDiscountCodeForCheckout({});
      }
    } catch (_e) {
      /* noop */
    }
    return null;
  }

  function root() {
    return document.getElementById('cutupCheckoutRoot');
  }

  function showError(msg) {
    const el = root();
    if (!el) return;
    el.innerHTML = `<div class="cutup-checkout-error" role="alert">${escapeHtml(msg)}</div>
      <p class="cutup-checkout-footnote"><a href="/dashboard.html" style="color:#a5b4fc">Back to dashboard</a></p>`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizePlan(p) {
    const k = String(p || '').trim().toLowerCase();
    return VALID_PLANS.has(k) ? k : null;
  }

  async function init() {
    const el = root();
    const sessionId = localStorage.getItem('cutup_session');
    const params = new URLSearchParams(window.location.search);
    const plan = normalizePlan(params.get('plan'));
    const payCancel = params.get('payment') === 'cancel';

    if (!sessionId) {
      window.location.href = '/';
      return;
    }

    if (!plan) {
      showError('Select a plan from the pricing page to continue.');
      return;
    }

    let profileRes;
    let profileData;
    try {
      profileRes = await fetch(`${API_BASE_URL}/api/user/profile`, {
        headers: { 'X-Session-Id': sessionId },
      });
      profileData = await profileRes.json().catch(() => ({}));
    } catch (_e) {
      showError('Could not load your profile. Please try again.');
      return;
    }

    if (!profileRes.ok || !profileData.profile) {
      window.location.href = `/dashboard.html?checkoutPlan=${encodeURIComponent(plan)}`;
      return;
    }

    if (profileData.profile.incomplete) {
      window.location.href = `/dashboard.html?checkoutPlan=${encodeURIComponent(plan)}`;
      return;
    }

    const p = profileData.profile;
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
    const label = PLAN_LABEL[plan] || plan;
    const eur = PLAN_EUR[plan] ?? '—';

    const cancelNote = payCancel
      ? `<p class="cutup-checkout-lead" style="color:#fbbf24;margin-top:-12px">Checkout was cancelled. You can try again when you’re ready.</p>`
      : '';

    el.classList.remove('cutup-checkout-loading');
    el.innerHTML = `
      <div class="cutup-checkout-card">
        <h1>Complete your upgrade</h1>
        <p class="cutup-checkout-lead">Review your plan and billing details. All information comes from your saved profile.</p>
        ${cancelNote}
        <div class="cutup-checkout-plan-row">
          <span class="cutup-checkout-plan-name">${escapeHtml(label)}</span>
          <span class="cutup-checkout-price">€${eur}<span>/mo</span></span>
        </div>
        <div class="cutup-checkout-section-title">Billing details</div>
        <dl class="cutup-checkout-dl">
          <div><dt>Full name</dt><dd>${escapeHtml(fullName)}</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(p.email || '—')}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHtml(p.phone || '—')}</dd></div>
          <div><dt>Country</dt><dd>${escapeHtml(p.country || '—')}</dd></div>
          <div><dt>Address</dt><dd>${escapeHtml(p.address || '—')}</dd></div>
          <div><dt>Postal code</dt><dd>${escapeHtml(p.postal_code || '—')}</dd></div>
        </dl>
        <div class="checkout-actions">
          <button type="button" class="checkout-btn checkout-btn--primary" id="cutupPayNowBtn">Pay now</button>
          <a class="checkout-btn checkout-btn--secondary" href="/dashboard.html?editProfile=1&amp;returnUrl=${encodeURIComponent(
            `/checkout.html?plan=${plan}`
          )}">Edit info</a>
        </div>
      </div>
      <p class="cutup-checkout-footnote">Secure checkout · Prices in EUR · Taxes may apply per your country</p>
    `;

    document.getElementById('cutupPayNowBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('cutupPayNowBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Redirecting…';
      }
      const provider = inferPaymentProvider();
      let discount = getHotDiscountCodeForCheckout();
      const body = {
        plan,
        provider,
        amount: typeof eur === 'number' ? eur : undefined,
        email: p.email || '',
        mobile: p.phone || '',
        firstName: p.first_name || '',
        lastName: p.last_name || '',
        address: p.address || '',
        postalCode: p.postal_code || '',
        country: p.country || '',
        ...(discount ? { discount } : {}),
      };
      try {
        const response = await fetch(`${API_BASE_URL}/api/payment/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
          },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (data.error === 'profile_incomplete') {
          window.location.href = `/dashboard.html?checkoutPlan=${encodeURIComponent(plan)}`;
          return;
        }
        if (data.error === 'Payment provider not configured' || data.error === 'Billing database not configured') {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Pay now';
          }
          alert('Payments are not configured right now. Please try again later.');
          return;
        }
        const redirect = data.redirect_url || data.payment_url || data.url;
        if (response.ok && redirect) {
          if (typeof sendAnalyticsEvent === 'function') {
            sendAnalyticsEvent('payment_started', { plan, sessionId });
          }
          if (discount && typeof window.cutupPaywallDiscountUsed === 'function') {
            window.cutupPaywallDiscountUsed(plan);
          }
          rememberPaymentRetryContext(plan, provider);
          window.location.href = redirect;
          return;
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Pay now';
        }
        alert(data.error || 'Could not start payment. Please try again.');
      } catch (_e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Pay now';
        }
        alert('Network error. Please try again.');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
