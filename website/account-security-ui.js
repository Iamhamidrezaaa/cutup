/**
 * Profile → Security & Danger zone modals and API wiring.
 */
(function (win) {
  const root = typeof globalThis !== 'undefined' ? globalThis : win;
  const OVERLAY_ID = 'cutupAccountModalOverlay';

  function apiBase() {
    return typeof root.CUTUP_API_BASE !== 'undefined' ? root.CUTUP_API_BASE : '';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closeModal() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.body.style.overflow = '';
  }

  function openModal({ title, bodyHtml, primaryLabel, primaryClass, onPrimary, secondaryLabel }) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'cutup-account-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <motion class="cutup-account-modal" role="document">
        <h2 class="cutup-account-modal-title">${escapeHtml(title)}</h2>
        <motion class="cutup-account-modal-body">${bodyHtml}</motion>
        <motion class="cutup-account-modal-actions">
          <button type="button" class="profile-settings-btn profile-settings-btn--ghost" data-modal-cancel>${escapeHtml(
            secondaryLabel || 'Cancel'
          )}</button>
          <button type="button" class="profile-settings-btn ${primaryClass || 'profile-settings-btn--primary'}" data-modal-primary>${escapeHtml(
            primaryLabel
          )}</button>
        </motion>
      </motion>
    `.replace(/<\/?motion/g, (t) => t.replace(/motion/g, 'div'));

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.querySelector('[data-modal-cancel]')?.addEventListener('click', closeModal);
    overlay.querySelector('[data-modal-primary]')?.addEventListener('click', () => {
      void onPrimary?.();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  async function apiPost(path, body) {
    const sessionId = win.localStorage?.getItem('cutup_session');
    const res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId || ''
      },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function showLogoutOtherSessionsModal() {
    openModal({
      title: 'Log out other sessions?',
      bodyHtml: `<p>You’ll stay signed in on this device, but Cutup will sign you out everywhere else.</p>`,
      primaryLabel: 'Log out sessions',
      primaryClass: 'profile-settings-btn--primary',
      secondaryLabel: 'Cancel',
      onPrimary: async () => {
        console.log('[logout-other-sessions]');
        const btn = document.querySelector('[data-modal-primary]');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Signing out…';
        }
        const { res, data } = await apiPost('/api/account/logout-other-sessions', {});
        closeModal();
        if (res.ok && data.ok) {
          if (typeof root.showDashboardBanner === 'function') {
            root.showDashboardBanner(
              data.message || 'Other sessions were signed out successfully.',
              'success'
            );
          }
        } else if (typeof root.showDashboardBanner === 'function') {
          root.showDashboardBanner('Could not sign out other sessions. Please try again.', 'error');
        }
      }
    });
  }

  function showDeleteStep1Modal() {
    openModal({
      title: 'Delete your account?',
      bodyHtml: `<p>This will permanently remove your Cutup account, exports, history, and saved outputs.</p>
        <p class="cutup-account-modal-muted">You’ll receive one final confirmation email before anything is deleted.</p>
        <p class="cutup-account-modal-muted">After deletion, this email cannot be used to sign up again for 30 days.</p>`,
      primaryLabel: 'Continue',
      primaryClass: 'profile-settings-btn--danger',
      secondaryLabel: 'Keep my account',
      onPrimary: async () => {
        console.log('[delete-account-request]');
        const btn = document.querySelector('[data-modal-primary]');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Sending email…';
        }
        const { res, data } = await apiPost('/api/account/request-deletion', {});
        closeModal();
        if (!res.ok || !data.ok) {
          if (typeof root.showDashboardBanner === 'function') {
            root.showDashboardBanner(
              data.error === 'email_failed'
                ? 'Could not send confirmation email. Try again later.'
                : 'Could not start account deletion. Please try again.',
              'error'
            );
          }
          return;
        }
        if (!data.emailSent) {
          if (typeof root.showDashboardBanner === 'function') {
            root.showDashboardBanner(
              'Confirmation email could not be sent. Please try again later or contact manager@cutup.shop.',
              'error'
            );
          }
          return;
        }
        console.log('[delete-email-sent]');
        showDeleteStep2Modal();
      }
    });
  }

  function showDeleteStep2Modal() {
    openModal({
      title: 'We’re really sorry to see you go.',
      bodyHtml: `<p>We’ve sent a confirmation email to your inbox.</p>
        <p>If there’s anything frustrating, broken, or missing from your experience, we’d genuinely love to hear it before you leave.</p>
        <p class="cutup-account-modal-muted">You can reach us at <a href="mailto:manager@cutup.shop">manager@cutup.shop</a>.</p>`,
      primaryLabel: 'Okay',
      primaryClass: 'profile-settings-btn--primary',
      secondaryLabel: 'Close',
      onPrimary: closeModal
    });
  }

  function bindProfileSecurityActions(root) {
    if (!root) return;
    root.querySelector('[data-prof-logout-all]')?.addEventListener('click', () => {
      showLogoutOtherSessionsModal();
    });
    root.querySelector('[data-prof-delete-account]')?.addEventListener('click', () => {
      showDeleteStep1Modal();
    });
  }

  root.CutupAccountSecurityUi = {
    bindProfileSecurityActions,
    closeModal
  };
})(typeof window !== 'undefined' ? window : globalThis);
