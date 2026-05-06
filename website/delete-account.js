(function () {
  const API_BASE =
    typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';

  const params = new URLSearchParams(window.location.search);
  const token = String(params.get('token') || '').trim();
  const card = document.getElementById('deleteAccountCard');

  function render(html) {
    if (card) card.innerHTML = html;
  }

  async function checkToken() {
    if (!token) return { status: 'invalid' };
    const r = await fetch(
      `${API_BASE}/api/account/delete-confirm?token=${encodeURIComponent(token)}`
    );
    const d = await r.json().catch(() => ({}));
    console.log('[delete-token-validated]', { status: d.status });
    return d;
  }

  async function confirmDelete() {
    const r = await fetch(`${API_BASE}/api/account/delete-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const d = await r.json().catch(() => ({}));
    if (d.ok && d.status === 'deleted') {
      console.log('[account-deleted]');
      try {
        localStorage.removeItem('cutup_session');
      } catch (_e) {
        /* noop */
      }
    }
    return d;
  }

  async function init() {
    if (!token) {
      render('<h1>Invalid link</h1><p>This deletion link is not valid. Request a new one from your profile settings.</p>');
      return;
    }

    const check = await checkToken();

    if (check.status === 'valid') {
      const actions = document.createElement('div');
      actions.className = 'delete-account-actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-settings-btn profile-settings-btn--danger';
      btn.id = 'confirmDeleteBtn';
      btn.textContent = 'Permanently delete my account';
      const cancel = document.createElement('a');
      cancel.href = '/';
      cancel.className = 'profile-settings-btn profile-settings-btn--ghost';
      cancel.style.cssText = 'text-align:center;text-decoration:none';
      cancel.textContent = 'Cancel and go home';
      actions.append(btn, cancel);

      card.innerHTML =
        '<h1>Confirm deletion</h1>' +
        '<p>This will permanently delete your Cutup account and all associated data. This cannot be undone.</p>';
      card.appendChild(actions);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        const out = await confirmDelete();
        if (out.ok && out.status === 'deleted') {
          render(
            '<h1>Goodbye</h1>' +
              '<p>Your Cutup account has been permanently deleted.</p>' +
              '<p>Thank you for being part of the journey.</p>' +
              '<p style="margin-top:20px"><a href="/">Return to Cutup</a></p>'
          );
        } else {
          render(
            '<h1>Something went wrong</h1><p>We could not complete deletion. The link may have expired. Contact <a href="mailto:manager@cutup.shop">manager@cutup.shop</a>.</p>'
          );
        }
      });
      return;
    }

    if (check.status === 'expired') {
      render(
        '<h1>Link expired</h1><p>This deletion link has expired. You can request a new one from Profile → Danger zone in your dashboard.</p>'
      );
      return;
    }
    if (check.status === 'used') {
      render(
        '<h1>Link already used</h1><p>This deletion link was already used. If you still have an account, sign in and request a new link.</p>'
      );
      return;
    }
    render('<h1>Invalid link</h1><p>This deletion link is not valid. Request a new one from your profile settings.</p>');
  }

  init().catch((e) => {
    console.error('[delete-account]', e);
    render('<h1>Error</h1><p>Could not load this page. Please try again later.</p>');
  });
})();
