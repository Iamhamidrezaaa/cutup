/**
 * Lightweight SMTP sending (optional). If SMTP_* env vars are missing, send is skipped safely.
 */
import nodemailer from 'nodemailer';

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEmailTransportConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

let transporterPromise = null;

function getTransporter() {
  if (!isEmailTransportConfigured()) return null;
  if (!transporterPromise) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    transporterPromise = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth:
        process.env.SMTP_USER != null && process.env.SMTP_USER !== ''
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
          : undefined,
    });
  }
  return transporterPromise;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ sent: boolean, skipped?: boolean, error?: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  const transport = getTransporter();
  if (!transport) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[email] SMTP not configured (SMTP_HOST / SMTP_FROM); skip send');
    }
    return { sent: false, skipped: true };
  }
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: String(to).trim(),
      subject: String(subject || '').slice(0, 200),
      html: String(html || ''),
      text: text != null ? String(text) : stripHtml(html),
    });
    return { sent: true };
  } catch (e) {
    console.error('[email] send failed', e.message);
    return { sent: false, error: e.message };
  }
}
