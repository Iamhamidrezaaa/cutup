(function () {
  const params = new URLSearchParams(window.location.search);
  const redirect = String(params.get('redirect') || '').trim();
  const plan = window.CutupPlanCheckout?.normalizePlanKey(params.get('plan'));
  const blockTicket = String(params.get('block_ticket') || '').trim();

  const API_BASE_URL =
    typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined'
      ? window.CUTUP_API_BASE
      : '';

  const signinEl = document.getElementById('cutupLoginSignin');
  const blockedEl = document.getElementById('cutupLoginBlocked');
  const blockedTitle = document.getElementById('cutupLoginBlockedTitle');
  const blockedBody = document.getElementById('cutupLoginBlockedBody');
  const blockedEmail = document.getElementById('cutupLoginBlockedEmail');
  const tryAnotherBtn = document.getElementById('cutupLoginTryAnotherBtn');
  const googleBtn = document.getElementById('cutupLoginGoogleBtn');

  function loginQueryBase() {
    const q = new URLSearchParams();
    if (redirect) q.set('redirect', redirect);
    if (plan) q.set('plan', plan);
    return q;
  }

  function showSigninView() {
    signinEl?.classList.remove('is-hidden');
    blockedEl?.classList.remove('is-visible');
    document.title = 'Sign in — Cutup';
  }

  function showBlockedView(data) {
    signinEl?.classList.add('is-hidden');
    blockedEl?.classList.add('is-visible');
    if (blockedTitle && data.title) blockedTitle.textContent = data.title;
    if (blockedBody) blockedBody.innerHTML = data.bodyHtml || '';
    if (blockedEmail) {
      if (data.emailMasked) {
        blockedEmail.hidden = false;
        blockedEmail.textContent = data.emailMasked;
      } else {
        blockedEmail.hidden = true;
      }
    }
    document.title = 'Sign-in blocked — Cutup';
    console.log('[login-blocked-ui]', { reason: data.reason, unlock: data.unlockDateLabel || null });
  }

  async function fetchBlockedState(ticket) {
    const url = `${API_BASE_URL}/api/account/login-blocked?ticket=${encodeURIComponent(ticket)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      console.warn('[login-blocked-ui] verify_failed', data.error);
      return null;
    }
    return data;
  }

  async function initBlockedFlow() {
    if (!blockTicket) return false;
    const data = await fetchBlockedState(blockTicket);
    if (!data) {
      showSigninView();
      const lead = document.getElementById('cutupLoginLead');
      if (lead) {
        lead.textContent = 'This sign-in link expired. Please try again with Google.';
      }
      return true;
    }
    if (!data.blocked) {
      const q = loginQueryBase();
      window.location.replace(`/login.html${q.toString() ? `?${q}` : ''}`);
      return true;
    }
    showBlockedView(data);
    return true;
  }

  async function startGoogleLogin(selectAccount) {
    if (googleBtn) {
      googleBtn.disabled = true;
      googleBtn.textContent = 'Connecting…';
    }
    try {
      if (plan && window.CutupPlanCheckout?.startGoogleOAuthCheckout) {
        await window.CutupPlanCheckout.startGoogleOAuthCheckout(plan, {
          source: redirect === 'checkout' ? 'checkout' : 'pricing',
          selectAccount: Boolean(selectAccount)
        });
        return;
      }
      const response = await fetch(`${API_BASE_URL}/api/oauth/google/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectAccount: Boolean(selectAccount) })
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      if (!data?.authUrl) throw new Error('No authUrl returned');
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('[oauth-direct-start] login failed', err);
      if (googleBtn) {
        googleBtn.disabled = false;
        googleBtn.textContent = 'Continue with Google';
      }
      alert('Sign-in failed. Please try again.');
    }
  }

  tryAnotherBtn?.addEventListener('click', () => {
    const q = loginQueryBase();
    window.history.replaceState({}, '', `/login.html${q.toString() ? `?${q}` : ''}`);
    showSigninView();
    void startGoogleLogin(true);
  });

  googleBtn?.addEventListener('click', () => {
    void startGoogleLogin(false);
  });

  void (async function main() {
    if (await initBlockedFlow()) return;

    const resume = String(params.get('resume') || '').trim() === '1';
    const hasPendingLink =
      Boolean(localStorage.getItem('cutup_pending_url')) ||
      Boolean(localStorage.getItem('pending_action')) ||
      Boolean(sessionStorage.getItem('cutup_pending_action'));
    if (resume || hasPendingLink) {
      const lead = document.getElementById('cutupLoginLead');
      if (lead) {
        lead.textContent =
          'Sign in to continue—we saved your link for right after you log in.';
      }
    }

    if (redirect === 'checkout' && plan && !window.CutupPlanCheckout?.isLoggedIn()) {
      console.log('[oauth-direct-start]', { plan, from: 'login_fallback' });
      window.CutupPlanCheckout.startGoogleOAuthCheckout(plan, { source: 'checkout' }).catch(() => {
        const lead = document.getElementById('cutupLoginLead');
        if (lead) {
          lead.textContent = 'Sign-in could not start automatically. Use the button below.';
        }
      });
      return;
    }

    if (window.CutupPlanCheckout?.isLoggedIn()) {
      if (resume || hasPendingLink) {
        console.log('[login-resume]', { to: 'homepage_resume' });
        window.location.replace('/?resume=1');
        return;
      }
      const target =
        window.CutupPlanCheckout.resolvePostLoginRedirect() ||
        (plan ? window.CutupPlanCheckout.buildCheckoutUrl(plan, { source: 'checkout' }) : null);
      if (target) {
        console.log('[checkout-after-oauth]', { target, from: 'login_page_logged_in' });
        window.location.replace(target);
        return;
      }
      window.location.replace('/dashboard.html');
    }
  })();
})();
