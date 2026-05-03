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

export default async function contactHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
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

    const html = `
      <h2>New Contact Message</h2>
      <p><strong>Name:</strong> ${safeName}</p>
      <p><strong>Email:</strong> ${safeEmail}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;">${safeMessage}</pre>
    `;

    // TODO: replace with support@cutup.shop later
    const result = await sendEmail({
      to: 'h.asgarizade@gmail.com',
      subject: `New contact message from ${rawEmail.slice(0, 180)}`,
      html,
    });

    if (!result.sent) {
      if (result.skipped) {
        return res.status(503).json({ ok: false, error: 'email_unconfigured' });
      }
      return res.status(500).json({ ok: false, error: 'send_failed' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] error', err);
    return res.status(500).json({ ok: false });
  }
}
