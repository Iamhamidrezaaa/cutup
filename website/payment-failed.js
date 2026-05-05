(function () {
  const API_BASE_URL =
    typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';

  const btn = document.getElementById('retryPaymentBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const sessionId = localStorage.getItem('cutup_session');
    if (!sessionId) {
      window.location.href = '/';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Retrying...';
    try {
      const r = await fetch(`${API_BASE_URL}/api/payment/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        }
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.redirect_url) {
        btn.disabled = false;
        btn.textContent = 'Retry payment';
        alert(d.error || 'Retry is not available right now.');
        return;
      }
      window.location.href = d.redirect_url;
    } catch (_e) {
      btn.disabled = false;
      btn.textContent = 'Retry payment';
      alert('Network error. Please try again.');
    }
  });
})();
