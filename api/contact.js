/**
 * Public contact form → SMTP via sendEmail (api/email.js).
 */
import { sendEmail } from './email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff && String(xff).trim()) {
    return String(xff).split(',')[0].trim().slice(0, 100);
  }
  const raw = req.socket?.remoteAddress || req.ip || '';
  return String(raw).slice(0, 100) || '—';
}

export default async function contactHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { website } = body;

    if (website != null && String(website).trim() !== '') {
      console.warn('[contact] bot blocked (honeypot triggered)');
      return res.json({ ok: true });
    }

    console.log('[contact] honeypot clean');

    const cfToken = body.cfToken;
    if (!cfToken || String(cfToken).trim() === '') {
      return res.status(400).json({ ok: false });
    }

    const turnstileSecret = process.env.CF_TURNSTILE_SECRET;
    if (!turnstileSecret || String(turnstileSecret).trim() === '') {
      console.error('[contact] CF_TURNSTILE_SECRET not configured');
      return res.status(503).json({ ok: false });
    }

    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: String(turnstileSecret).trim(),
        response: String(cfToken).trim(),
      }),
    });

    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyData.success) {
      console.warn('[contact] turnstile verify failed', verifyData['error-codes']);
      return res.status(403).json({ ok: false });
    }

    const { name, email, message } = body;

    const rawEmail = String(email || '').trim();
    const rawMessage = String(message || '').trim();

    if (!rawEmail || !rawMessage) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }
    if (!EMAIL_RE.test(rawEmail)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }

    const safeName = escapeHtml(String(name || 'Unknown').slice(0, 100));
    const safeEmail = escapeHtml(rawEmail.slice(0, 200));
    const safeMessage = escapeHtml(rawMessage.slice(0, 5000));

    const subjectName = String(name || 'Unknown')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 100) || 'Unknown';

    const sentAt = new Date().toISOString();
    const ua = escapeHtml(String(req.headers['user-agent'] || '—').slice(0, 500));
    const ip = escapeHtml(clientIp(req));

    const html = `
      <div>
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Message:</strong></p>
        <pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;">${safeMessage}</pre>
        <hr />
        <p><strong>Time:</strong> ${sentAt}</p>
        <p><strong>User Agent:</strong> ${ua}</p>
        <p><strong>IP:</strong> ${ip}</p>
      </div>
    `;

    // TODO: replace with support@cutup.shop later
    const result = await sendEmail({
      to: 'h.asgarizade@gmail.com',
      subject: `[Cutup] New contact from ${subjectName}`,
      html,
    });

    if (!result.sent) {
      if (result.skipped) {
        return res.status(503).json({ ok: false, error: 'email_unconfigured' });
      }
      return res.status(500).json({ ok: false, error: 'send_failed' });
    }

    console.log('[contact] email sent ok', { subjectSnippet: subjectName.slice(0, 40) });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] error', err);
    return res.status(500).json({ ok: false });
  }
}
