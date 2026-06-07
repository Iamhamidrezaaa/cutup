export async function verifyTurnstileToken(cfToken) {
  const token = String(cfToken || '').trim();
  if (!token) return { ok: false, error: 'captcha_required' };

  const secret = process.env.CF_TURNSTILE_SECRET;
  if (!secret || !String(secret).trim()) {
    return { ok: false, error: 'captcha_not_configured' };
  }

  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: String(secret).trim(),
      response: token,
    }),
  });

  const data = await verifyRes.json().catch(() => ({}));
  if (!data.success) {
    return { ok: false, error: 'captcha_failed', codes: data['error-codes'] };
  }
  return { ok: true };
}
