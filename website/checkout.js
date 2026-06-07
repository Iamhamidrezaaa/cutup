(function () {
  const CHECKOUT_BUILD_ID = 'PLAN_FLOW_2026_01';
  const CHECKOUT_PROFILE_OVERLAY_ID = 'cutupCheckoutProfileOverlay';
  console.log('[checkout-runtime] loaded', CHECKOUT_BUILD_ID);

  const API_BASE_URL =
    typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';
  const PAYMENT_RETRY_KEY = 'cutup_payment_retry';
  const VALID_PLANS = new Set(['starter', 'pro', 'business']);
  const PAYMENT_CREATE_TIMEOUT_MS = 95000;

  const COUNTRY_OPTIONS = [
    { v: 'IR', l: 'Iran' },
    { v: 'US', l: 'United States' },
    { v: 'GB', l: 'United Kingdom' },
    { v: 'DE', l: 'Germany' },
    { v: 'FR', l: 'France' },
    { v: 'IT', l: 'Italy' },
    { v: 'ES', l: 'Spain' },
    { v: 'NL', l: 'Netherlands' },
    { v: 'BE', l: 'Belgium' },
    { v: 'AT', l: 'Austria' },
    { v: 'CH', l: 'Switzerland' },
    { v: 'SE', l: 'Sweden' },
    { v: 'NO', l: 'Norway' },
    { v: 'DK', l: 'Denmark' },
    { v: 'FI', l: 'Finland' },
    { v: 'PL', l: 'Poland' },
    { v: 'PT', l: 'Portugal' },
    { v: 'GR', l: 'Greece' },
    { v: 'TR', l: 'Türkiye' },
    { v: 'AE', l: 'United Arab Emirates' },
    { v: 'SA', l: 'Saudi Arabia' },
    { v: 'IN', l: 'India' },
    { v: 'CN', l: 'China' },
    { v: 'JP', l: 'Japan' },
    { v: 'KR', l: 'South Korea' },
    { v: 'CA', l: 'Canada' },
    { v: 'AU', l: 'Australia' },
    { v: 'NZ', l: 'New Zealand' },
    { v: 'BR', l: 'Brazil' },
    { v: 'MX', l: 'Mexico' },
    { v: 'IE', l: 'Ireland' },
    { v: 'LU', l: 'Luxembourg' },
    { v: 'CZ', l: 'Czechia' },
    { v: 'HU', l: 'Hungary' },
    { v: 'RO', l: 'Romania' },
    { v: 'BG', l: 'Bulgaria' },
    { v: 'HR', l: 'Croatia' },
    { v: 'SI', l: 'Slovenia' },
    { v: 'SK', l: 'Slovakia' },
    { v: 'LT', l: 'Lithuania' },
    { v: 'LV', l: 'Latvia' },
    { v: 'EE', l: 'Estonia' },
    { v: 'CY', l: 'Cyprus' },
    { v: 'MT', l: 'Malta' },
    { v: 'IS', l: 'Iceland' },
    { v: 'RU', l: 'Russia' },
    { v: 'UA', l: 'Ukraine' },
    { v: 'IQ', l: 'Iraq' },
    { v: 'AF', l: 'Afghanistan' },
    { v: 'PK', l: 'Pakistan' },
    { v: 'EG', l: 'Egypt' },
    { v: 'ZA', l: 'South Africa' },
    { v: 'SG', l: 'Singapore' },
    { v: 'MY', l: 'Malaysia' },
    { v: 'TH', l: 'Thailand' },
    { v: 'VN', l: 'Vietnam' },
    { v: 'ID', l: 'Indonesia' },
    { v: 'PH', l: 'Philippines' },
    { v: 'AR', l: 'Argentina' },
    { v: 'CL', l: 'Chile' },
    { v: 'CO', l: 'Colombia' },
  ];

  const PLAN_LABEL = {
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business',
  };

  const PLAN_EUR = {
    starter: 7.99,
    pro: 19.99,
    business: 49.99,
  };

  function inferPaymentProvider() {
    if (typeof window !== 'undefined' && window.CUTUP_PAYMENT_PROVIDER) {
      return 'yekpay';
    }
    try {
      const lang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
      if (lang.startsWith('fa')) return 'yekpay';
    } catch (_e) {
      /* noop */
    }
    return 'yekpay';
  }

  function rememberPaymentRetryContext(planKey, provider) {
    try {
      sessionStorage.setItem(PAYMENT_RETRY_KEY, JSON.stringify({ planKey, provider }));
    } catch (_e) {
      /* noop */
    }
  }

  function getCouponFromUrl() {
    const p = new URLSearchParams(window.location.search);
    return String(p.get('coupon') || '').trim().toUpperCase();
  }

  async function getRecommendedCoupon(sessionId, plan) {
    try {
      if (window.CutupOffersResolver && typeof window.CutupOffersResolver.resolveActiveUserOffers === 'function') {
        const resolved = await window.CutupOffersResolver.resolveActiveUserOffers({ sessionId });
        const offerPlan = String(window.CutupOffersResolver.inferTargetPlan?.(resolved?.selectedOffer) || '').toLowerCase();
        const code = String(resolved?.selectedOffer?.code || '').trim().toUpperCase();
        if (resolved?.ok && code && offerPlan === String(plan || '').toLowerCase()) return code;
      }
      const r = await fetch(`${API_BASE_URL}/api/offers?plan=${encodeURIComponent(plan)}`, {
        headers: { 'X-Session-Id': sessionId }
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) return '';
      return String(d?.recommended?.code || '').trim().toUpperCase();
    } catch (_e) {
      return '';
    }
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

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function normalizePlan(p) {
    const k = String(p || '').trim().toLowerCase();
    return VALID_PLANS.has(k) ? k : null;
  }

  function isProfileGateIncomplete(profile) {
    if (window.CutupPlanCheckout?.isProfileGateIncomplete) {
      return window.CutupPlanCheckout.isProfileGateIncomplete(profile);
    }
    if (!profile) return true;
    return (
      !String(profile.first_name || '').trim() ||
      !String(profile.last_name || '').trim() ||
      !String(profile.phone || '').trim() ||
      !String(profile.country || '').trim() ||
      !String(profile.address || '').trim()
    );
  }

  function applyProfileToBillingFields(profile) {
    const p = profile || {};
    const map = {
      cutupFirstName: p.first_name || '',
      cutupLastName: p.last_name || '',
      cutupPhone: p.phone || '',
      cutupCountry: String(p.country || '').trim().toUpperCase().slice(0, 2),
      cutupAddress: p.address || '',
      cutupPostal: p.postal_code || ''
    };
    Object.entries(map).forEach(([id, val]) => {
      const node = document.getElementById(id);
      if (node) node.value = val;
    });
    const emailEl = document.getElementById('cutupEmail');
    if (emailEl && p.email) emailEl.value = String(p.email).trim();
    syncPayButtonBillingGate();
  }

  function closeCheckoutProfileModal() {
    const overlay = document.getElementById(CHECKOUT_PROFILE_OVERLAY_ID);
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
  }

  function openCheckoutProfileModal(sessionId, profile) {
    closeCheckoutProfileModal();
    console.log('[profile-required]', { checkout: true });

    const p = profile || {};
    const email = String(p.email || '').trim();
    const countryVal = String(p.country || 'IR').trim().toUpperCase().slice(0, 2);

    const overlay = document.createElement('div');
    overlay.id = CHECKOUT_PROFILE_OVERLAY_ID;
    overlay.className = 'cutup-checkout-profile-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cutupCheckoutProfileTitle');
    overlay.innerHTML = `
      <div class="cutup-checkout-profile-modal">
        <h2 id="cutupCheckoutProfileTitle">Complete your profile</h2>
        <p class="cutup-checkout-profile-lead">We need a few details before you can pay. You will stay on this checkout page.</p>
        <form id="cutupCheckoutProfileForm" class="cutup-checkout-profile-form" novalidate>
          <label><span>First name</span><input type="text" data-cprof-first maxlength="255" value="${escapeAttr(p.first_name || '')}" required /></label>
          <label><span>Last name</span><input type="text" data-cprof-last maxlength="255" value="${escapeAttr(p.last_name || '')}" required /></label>
          <label><span>Email</span><input type="email" data-cprof-email readonly value="${escapeAttr(email)}" /></label>
          <label><span>Phone</span><input type="tel" data-cprof-phone maxlength="64" value="${escapeAttr(p.phone || '')}" required /></label>
          <label><span>Country</span><select data-cprof-country required><option value="">Select country</option>${countrySelectHtml(countryVal)}</select></label>
          <label class="cutup-checkout-profile-wide"><span>Address</span><textarea data-cprof-address rows="2" maxlength="2000" required>${escapeHtml(p.address || '')}</textarea></label>
          <label><span>Postal code</span><input type="text" data-cprof-postal maxlength="32" value="${escapeAttr(p.postal_code || '')}" /></label>
          <p id="cutupCheckoutProfileErr" class="cutup-checkout-profile-err" hidden role="alert"></p>
          <div class="cutup-checkout-profile-actions">
            <button type="submit" class="checkout-btn checkout-btn--primary">Save and continue</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const form = overlay.querySelector('#cutupCheckoutProfileForm');
    const errEl = overlay.querySelector('#cutupCheckoutProfileErr');

    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = {
        email,
        first_name: String(form.querySelector('[data-cprof-first]')?.value || '').trim(),
        last_name: String(form.querySelector('[data-cprof-last]')?.value || '').trim(),
        phone: String(form.querySelector('[data-cprof-phone]')?.value || '').trim(),
        country: String(form.querySelector('[data-cprof-country]')?.value || '').trim().toUpperCase().slice(0, 2),
        address: String(form.querySelector('[data-cprof-address]')?.value || '').trim(),
        postal_code: String(form.querySelector('[data-cprof-postal]')?.value || '').trim()
      };
      if (
        !payload.first_name ||
        !payload.last_name ||
        !payload.phone ||
        !payload.country ||
        !payload.address
      ) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = 'Please fill in first name, last name, phone, country, and address.';
        }
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
      }
      try {
        const saveRes = await fetch(`${API_BASE_URL}/api/user/profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
          body: JSON.stringify(payload)
        });
        const saveData = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok || !saveData.ok) {
          if (errEl) {
            errEl.hidden = false;
            errEl.textContent = saveData.error || saveData.message || 'Could not save profile.';
          }
          return;
        }
        const saved = saveData.profile || payload;
        console.log('[profile-complete]', { checkout: true });
        closeCheckoutProfileModal();
        applyProfileToBillingFields(saved);
        const banner = document.querySelector('.cutup-checkout-banner-warn');
        if (banner) banner.remove();
      } catch (e) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = e?.message || 'Network error. Please try again.';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save and continue';
        }
      }
    });
  }

  function countrySelectHtml(selectedUpper) {
    const sel = String(selectedUpper || '').trim().toUpperCase().slice(0, 2);
    const opts = COUNTRY_OPTIONS.map(
      (c) =>
        `<option value="${escapeAttr(c.v)}"${c.v === sel ? ' selected' : ''}>${escapeHtml(c.l)} (${escapeHtml(c.v)})</option>`
    ).join('');
    const extra = sel && !COUNTRY_OPTIONS.some((c) => c.v === sel)
      ? `<option value="${escapeAttr(sel)}" selected>${escapeHtml(sel)} (saved)</option>`
      : '';
    return `${extra}${opts}`;
  }

  function setFieldError(fieldId, message) {
    const el = document.getElementById(`${fieldId}Err`);
    if (!el) return;
    const has = Boolean(message);
    el.hidden = !has;
    el.textContent = message || '';
  }

  function getBillingFieldValues(sessionEmail) {
    const first = String(document.getElementById('cutupFirstName')?.value || '').trim();
    const last = String(document.getElementById('cutupLastName')?.value || '').trim();
    const email = String(sessionEmail || '').trim();
    const phone = String(document.getElementById('cutupPhone')?.value || '').trim();
    const country = String(document.getElementById('cutupCountry')?.value || '').trim().toUpperCase().slice(0, 2);
    const address = String(document.getElementById('cutupAddress')?.value || '').trim();
    const postal = String(document.getElementById('cutupPostal')?.value || '').trim();
    return { first, last, email, phone, country, address, postal };
  }

  function validateBillingFields(showMessages) {
    const sessionEmail = String(document.getElementById('cutupEmail')?.value || '').trim();
    const { first, last, phone, country, address, postal } = getBillingFieldValues(sessionEmail);
    let ok = true;
    const set = showMessages ? setFieldError : () => {};

    if (!first) {
      ok = false;
      set('cutupFirstName', 'First name is required.');
    } else set('cutupFirstName', '');

    if (!last) {
      ok = false;
      set('cutupLastName', 'Last name is required.');
    } else set('cutupLastName', '');

    if (!phone || phone.length < 6) {
      ok = false;
      set('cutupPhone', 'Enter a valid phone number (at least 6 characters).');
    } else set('cutupPhone', '');

    if (!country || country.length !== 2) {
      ok = false;
      set('cutupCountry', 'Select a country (ISO-2).');
    } else set('cutupCountry', '');

    if (!address || address.length < 5) {
      ok = false;
      set('cutupAddress', 'Address is required (at least 5 characters).');
    } else set('cutupAddress', '');

    if (!postal || postal.length < 2) {
      ok = false;
      set('cutupPostal', 'Postal code is required.');
    } else set('cutupPostal', '');

    if (!sessionEmail || !sessionEmail.includes('@')) {
      ok = false;
    }

    return ok;
  }

  function syncPayButtonBillingGate() {
    const btn = document.getElementById('cutupPayNowBtn');
    if (!btn) return;
    const billingOk = validateBillingFields(false);
    btn.dataset.billingValid = billingOk ? '1' : '0';
    if (btn.dataset.processing === '1') return;
    btn.disabled = !billingOk;
  }

  function setPaymentApiError(message) {
    const el = document.getElementById('cutupPaymentApiError');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function formatPaymentFailurePayload(data, httpStatus) {
    const lines = [`HTTP ${httpStatus}`];
    if (data && typeof data === 'object') {
      if (data.error) lines.push(`error: ${data.error}`);
      if (data.success === false) lines.push('success: false');
      if (data.timedOut) lines.push('upstream: timed out');
      if (data.providerStatus != null && data.providerStatus !== '') lines.push(`providerStatus: ${data.providerStatus}`);
      if (data.callbackUrl) lines.push(`callbackUrl: ${data.callbackUrl}`);
      if (data.merchantConfigured === false) lines.push('merchantConfigured: false');
      if (data.providerBody != null) {
        try {
          const pb =
            typeof data.providerBody === 'string' ? data.providerBody : JSON.stringify(data.providerBody, null, 2);
          lines.push('providerBody:', pb.slice(0, 2500) + (pb.length > 2500 ? '\n…' : ''));
        } catch (_e) {
          lines.push('providerBody: [unserializable]');
        }
      }
      if (data.reason) lines.push(`reason: ${data.reason}`);
      if (data.details && typeof data.details === 'object' && data.details.Message) {
        lines.push(`details: ${data.details.Message}`);
      }
    } else if (data) {
      lines.push(String(data));
    }
    return lines.join('\n');
  }

  async function init() {
    const el = root();
    const sessionId = localStorage.getItem('cutup_session');
    const params = new URLSearchParams(window.location.search);
    const plan = normalizePlan(params.get('plan'));
    const payCancel = params.get('payment') === 'cancel';

    console.log('[checkout-route]', { plan, loggedIn: Boolean(sessionId) });

    if (!sessionId) {
      if (plan && window.CutupPlanCheckout?.startGoogleOAuthCheckout) {
        console.log('[checkout-route]', { plan, reason: 'oauth_direct_no_session' });
        try {
          await window.CutupPlanCheckout.startGoogleOAuthCheckout(plan, { source: 'checkout' });
        } catch (_e) {
          showError('Sign-in failed. Please try again from the pricing page.');
        }
        return;
      }
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
      showError('Could not verify your billing profile. Please try again.');
      return;
    }

    const p = profileData.profile;
    const incomplete = Boolean(p.incomplete);
    const sessionEmail = String(p.email || '').trim();

    const label = PLAN_LABEL[plan] || plan;
    const eur = PLAN_EUR[plan] ?? '—';
    const baseAmount = typeof eur === 'number' ? eur : 0;
    let pricingState = {
      originalAmountEur: baseAmount,
      discountAmountEur: 0,
      finalAmountEur: baseAmount,
      code: ''
    };

    const cancelNote = payCancel
      ? `<p class="cutup-checkout-lead" style="color:#fbbf24;margin-top:-12px">Checkout was cancelled. You can try again when you’re ready.</p>`
      : '';

    const incompleteBanner = incomplete
      ? `<div class="cutup-checkout-banner-warn" role="status">Your profile was incomplete. Fill in the fields below before paying — we will save them to your account.</div>`
      : '';

    const countryVal = String(p.country || 'IR').trim().toUpperCase().slice(0, 2);

    el.classList.remove('cutup-checkout-loading');
    el.innerHTML = `
      <div class="cutup-checkout-card">
        <h1>Complete your upgrade</h1>
        <p class="cutup-checkout-lead">Review your plan, edit billing details if needed, then pay securely.</p>
        ${cancelNote}
        ${incompleteBanner}
        <div class="cutup-checkout-plan-row">
          <span class="cutup-checkout-plan-name">${escapeHtml(label)}</span>
          <span class="cutup-checkout-price">€${eur}<span>/mo</span></span>
        </div>
        <div class="cutup-checkout-coupon-row">
          <label class="cutup-checkout-coupon-label" for="cutupCouponInput">Coupon code</label>
          <div class="cutup-checkout-coupon-input-wrap">
            <input id="cutupCouponInput" class="cutup-checkout-coupon-input" type="text" placeholder="ENTER CODE" autocomplete="off">
            <button type="button" id="cutupCouponApplyBtn" class="checkout-btn checkout-btn--secondary">Apply</button>
          </div>
          <p id="cutupCouponInlineMsg" class="cutup-checkout-coupon-msg" hidden></p>
        </div>
        <div class="cutup-checkout-totals" id="cutupCheckoutTotals">
          <div><span>Original</span><strong id="cutupOriginalAmount">€${baseAmount.toFixed(2)}</strong></div>
          <div><span>Discount</span><strong id="cutupDiscountAmount">-€0.00</strong></div>
          <div class="cutup-checkout-total-final"><span>Final</span><strong id="cutupFinalAmount">€${baseAmount.toFixed(2)}</strong></div>
        </div>
        <div class="cutup-checkout-section-title">Billing details</div>
        <div class="cutup-checkout-fields" id="cutupBillingFields">
          <div class="cutup-checkout-field">
            <label for="cutupFirstName">First name</label>
            <input id="cutupFirstName" class="cutup-checkout-input" type="text" autocomplete="given-name" maxlength="255" value="${escapeAttr(p.first_name || '')}">
            <p id="cutupFirstNameErr" class="cutup-checkout-field-error" hidden></p>
          </div>
          <div class="cutup-checkout-field">
            <label for="cutupLastName">Last name</label>
            <input id="cutupLastName" class="cutup-checkout-input" type="text" autocomplete="family-name" maxlength="255" value="${escapeAttr(p.last_name || '')}">
            <p id="cutupLastNameErr" class="cutup-checkout-field-error" hidden></p>
          </div>
          <div class="cutup-checkout-field">
            <label for="cutupEmail">Email</label>
            <input id="cutupEmail" class="cutup-checkout-input" type="email" autocomplete="email" readonly value="${escapeAttr(sessionEmail)}">
            <p class="cutup-checkout-field-hint">Sign-in email (cannot be changed here).</p>
            <p id="cutupEmailErr" class="cutup-checkout-field-error" hidden></p>
          </div>
          <div class="cutup-checkout-field">
            <label for="cutupPhone">Phone</label>
            <input id="cutupPhone" class="cutup-checkout-input" type="tel" autocomplete="tel" maxlength="64" value="${escapeAttr(p.phone || '')}">
            <p id="cutupPhoneErr" class="cutup-checkout-field-error" hidden></p>
          </div>
          <div class="cutup-checkout-field">
            <label for="cutupCountry">Country</label>
            <select id="cutupCountry" class="cutup-checkout-select" autocomplete="country">
              ${countrySelectHtml(countryVal)}
            </select>
            <p id="cutupCountryErr" class="cutup-checkout-field-error" hidden></p>
          </div>
          <div class="cutup-checkout-field">
            <label for="cutupAddress">Address</label>
            <textarea id="cutupAddress" class="cutup-checkout-textarea" autocomplete="street-address" maxlength="2000">${escapeHtml(p.address || '')}</textarea>
            <p id="cutupAddressErr" class="cutup-checkout-field-error" hidden></p>
          </div>
          <div class="cutup-checkout-field">
            <label for="cutupPostal">Postal code</label>
            <input id="cutupPostal" class="cutup-checkout-input" type="text" autocomplete="postal-code" maxlength="32" value="${escapeAttr(p.postal_code || '')}">
            <p id="cutupPostalErr" class="cutup-checkout-field-error" hidden></p>
          </div>
        </div>
        <div id="cutupPaymentApiError" class="cutup-checkout-payment-error" hidden role="alert"></div>
        <div class="cutup-checkout-legal" id="cutupCheckoutLegal">
          <div class="cutup-checkout-legal-row">
            <input
              type="checkbox"
              id="cutupLegalAgree"
              name="cutupLegalAgree"
              class="cutup-checkout-legal-checkbox"
              aria-describedby="cutupLegalAgreeError"
              aria-invalid="false"
            />
            <label for="cutupLegalAgree" class="cutup-checkout-legal-label">
              I agree to the Cutup <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </label>
          </div>
          <p id="cutupLegalAgreeError" class="cutup-checkout-legal-error" role="alert" hidden></p>
        </div>
        <div class="checkout-actions">
          <button type="button" class="checkout-btn checkout-btn--primary" id="cutupPayNowBtn" disabled>Pay now</button>
          <a class="checkout-btn checkout-btn--secondary" id="cutupOpenDashboardBtn" href="/dashboard.html">Open dashboard</a>
        </div>
      </div>
      <p class="cutup-checkout-footnote">Secure checkout · Prices in EUR · Taxes may apply per your country · <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a></p>
    `;

    const couponInput = document.getElementById('cutupCouponInput');
    const couponApplyBtn = document.getElementById('cutupCouponApplyBtn');
    const couponMsg = document.getElementById('cutupCouponInlineMsg');
    const originalAmountEl = document.getElementById('cutupOriginalAmount');
    const discountAmountEl = document.getElementById('cutupDiscountAmount');
    const finalAmountEl = document.getElementById('cutupFinalAmount');

    function renderPricing() {
      if (originalAmountEl) originalAmountEl.textContent = `€${Number(pricingState.originalAmountEur || 0).toFixed(2)}`;
      if (discountAmountEl) discountAmountEl.textContent = `-€${Number(pricingState.discountAmountEur || 0).toFixed(2)}`;
      if (finalAmountEl) finalAmountEl.textContent = `€${Number(pricingState.finalAmountEur || 0).toFixed(2)}`;
    }

    function setCouponMessage(message, type = 'error') {
      if (!couponMsg) return;
      couponMsg.hidden = !message;
      couponMsg.textContent = message || '';
      couponMsg.dataset.state = type;
    }

    async function applyCouponCode(rawCode) {
      const code = String(rawCode || '').trim().toUpperCase();
      if (!code) {
        pricingState = { originalAmountEur: baseAmount, discountAmountEur: 0, finalAmountEur: baseAmount, code: '' };
        renderPricing();
        setCouponMessage('');
        if (couponInput) couponInput.value = '';
        return;
      }
      setCouponMessage('Checking coupon...', 'info');
      if (couponApplyBtn) couponApplyBtn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/api/offers/validate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId
          },
          body: JSON.stringify({
            code,
            planKey: plan,
            amountEur: baseAmount
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.pricing) {
          pricingState = { originalAmountEur: baseAmount, discountAmountEur: 0, finalAmountEur: baseAmount, code: '' };
          renderPricing();
          setCouponMessage('This coupon is invalid or expired.', 'error');
          return;
        }
        pricingState = {
          originalAmountEur: Number(data.pricing.originalAmountEur || baseAmount),
          discountAmountEur: Number(data.pricing.discountAmountEur || 0),
          finalAmountEur: Number(data.pricing.finalAmountEur || baseAmount),
          code
        };
        renderPricing();
        if (couponInput) couponInput.value = code;
        setCouponMessage('Coupon applied.', 'success');
      } catch (_e) {
        setCouponMessage('Could not validate coupon right now.', 'error');
      } finally {
        if (couponApplyBtn) couponApplyBtn.disabled = false;
      }
    }

    couponApplyBtn?.addEventListener('click', () => {
      applyCouponCode(couponInput?.value || '');
    });
    couponInput?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        applyCouponCode(couponInput?.value || '');
      }
    });

    const openDashboardBtn = document.getElementById('cutupOpenDashboardBtn');
    openDashboardBtn?.addEventListener('click', () => {
      console.log('[checkout-open-dashboard]', {
        build: CHECKOUT_BUILD_ID,
        href: openDashboardBtn.href,
        plan
      });
    });

    const couponFromUrl = getCouponFromUrl();
    if (couponFromUrl) {
      void applyCouponCode(couponFromUrl);
    } else {
      const autoCoupon = await getRecommendedCoupon(sessionId, plan);
      if (autoCoupon) void applyCouponCode(autoCoupon);
    }

    try {
      if (window.CutupOffersResolver) {
        const resolved = await window.CutupOffersResolver.resolveActiveUserOffers({ sessionId });
        window.CutupOffersResolver.renderGlobalRibbon(resolved);
      }
    } catch (_e) {
      /* noop */
    }

    const billingIds = ['cutupFirstName', 'cutupLastName', 'cutupPhone', 'cutupCountry', 'cutupAddress', 'cutupPostal'];
    billingIds.forEach((id) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.addEventListener('input', () => {
        setFieldError(id, '');
        syncPayButtonBillingGate();
      });
      node.addEventListener('blur', () => {
        validateBillingFields(true);
        syncPayButtonBillingGate();
      });
    });

    syncPayButtonBillingGate();

    if (isProfileGateIncomplete(p)) {
      openCheckoutProfileModal(sessionId, p);
    } else {
      console.log('[profile-complete]', { gate: false });
    }

    const legalCheckbox = document.getElementById('cutupLegalAgree');
    const legalError = document.getElementById('cutupLegalAgreeError');

    function setLegalError(message) {
      if (!legalError || !legalCheckbox) return;
      const has = Boolean(message);
      legalError.hidden = !has;
      legalError.textContent = message || '';
      legalCheckbox.setAttribute('aria-invalid', has ? 'true' : 'false');
    }

    legalCheckbox?.addEventListener('change', () => {
      if (legalCheckbox.checked) setLegalError('');
    });

    document.getElementById('cutupPayNowBtn')?.addEventListener('click', async () => {
      setPaymentApiError('');
      if (!validateBillingFields(true)) {
        syncPayButtonBillingGate();
        return;
      }
      if (legalCheckbox && !legalCheckbox.checked) {
        setLegalError('Please confirm that you agree to the Terms of Service and Privacy Policy to continue.');
        legalCheckbox.focus();
        return;
      }
      setLegalError('');
      const btn = document.getElementById('cutupPayNowBtn');
      if (btn) {
        btn.dataset.processing = '1';
        btn.disabled = true;
        btn.textContent = 'Saving profile…';
      }

      const vals = getBillingFieldValues(sessionEmail);
      const profilePayload = {
        email: sessionEmail,
        first_name: vals.first,
        last_name: vals.last,
        phone: vals.phone,
        country: vals.country,
        address: vals.address,
        postal_code: vals.postal
      };

      try {
        const saveRes = await fetch(`${API_BASE_URL}/api/user/profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId
          },
          body: JSON.stringify(profilePayload)
        });
        const saveData = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok || !saveData.ok) {
          if (btn) {
            btn.dataset.processing = '0';
            btn.textContent = 'Pay now';
            syncPayButtonBillingGate();
          }
          setPaymentApiError(
            `Could not save billing profile.\nHTTP ${saveRes.status}\n${saveData.error || JSON.stringify(saveData)}`
          );
          return;
        }
      } catch (e) {
        if (btn) {
          btn.dataset.processing = '0';
          btn.textContent = 'Pay now';
          syncPayButtonBillingGate();
        }
        setPaymentApiError(`Profile save failed: ${e?.message || 'network_error'}`);
        return;
      }

      if (btn) {
        btn.textContent = 'Starting payment…';
      }

      const provider = inferPaymentProvider();
      const body = {
        plan,
        provider,
        amount: Number(pricingState.finalAmountEur || baseAmount),
        email: vals.email,
        mobile: vals.phone,
        firstName: vals.first,
        lastName: vals.last,
        address: vals.address,
        postalCode: vals.postal,
        country: vals.country,
        couponCode: pricingState.code || undefined
      };

      console.log(
        '[payment-create-request]',
        JSON.stringify({
          endpoint: `${API_BASE_URL}/api/payment/create`,
          timeoutMs: PAYMENT_CREATE_TIMEOUT_MS,
          plan: body.plan,
          amount: body.amount,
          currency: 'EUR',
          provider: body.provider
        })
      );

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), PAYMENT_CREATE_TIMEOUT_MS);

      try {
        const response = await fetch(`${API_BASE_URL}/api/payment/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        const text = await response.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { parseError: true, rawPreview: text.slice(0, 800) };
        }

        console.log(
          '[payment-create-response]',
          JSON.stringify({
            httpStatus: response.status,
            ok: response.ok,
            hasRedirect: Boolean(data.redirect_url || data.payment_url || data.url),
            error: data.error || null
          })
        );

        const redirect = data.redirect_url || data.payment_url || data.url;
        if (response.ok && redirect) {
          if (typeof sendAnalyticsEvent === 'function') {
            sendAnalyticsEvent('payment_started', { plan, sessionId });
          }
          if (pricingState.code && typeof window.cutupPaywallDiscountUsed === 'function') {
            window.cutupPaywallDiscountUsed(plan);
          }
          rememberPaymentRetryContext(plan, provider);
          window.location.href = redirect;
          return;
        }

        if (btn) {
          btn.dataset.processing = '0';
          btn.textContent = 'Pay now';
          syncPayButtonBillingGate();
        }
        console.error('[payment-create-response]', data);
        setPaymentApiError(formatPaymentFailurePayload(data, response.status));
        const couponFallback = data?.details?.Message || data?.details?.message;
        if (couponFallback && typeof couponFallback === 'string') {
          setCouponMessage(couponFallback, 'error');
        }
      } catch (err) {
        if (btn) {
          btn.dataset.processing = '0';
          btn.textContent = 'Pay now';
          syncPayButtonBillingGate();
        }
        const aborted = err?.name === 'AbortError' || String(err?.message || '').includes('aborted');
        const msg = aborted
          ? `Request timed out after ${PAYMENT_CREATE_TIMEOUT_MS / 1000}s. The server may be slow or unreachable.`
          : `Network error: ${err?.message || err}`;
        console.error('[payment-create-response]', err);
        setPaymentApiError(msg);
      } finally {
        clearTimeout(tid);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
