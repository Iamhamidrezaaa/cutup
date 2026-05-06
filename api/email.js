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

function smtpEnvPresent(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== '';
}

export function isEmailTransportConfigured() {
  return (
    smtpEnvPresent('SMTP_HOST') &&
    smtpEnvPresent('SMTP_FROM') &&
    smtpEnvPresent('SMTP_USER') &&
    smtpEnvPresent('SMTP_PASS')
  );
}

let transporterPromise = null;

function getTransporter() {
  if (!isEmailTransportConfigured()) return null;
  if (!transporterPromise) {
    transporterPromise = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
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
    console.warn(
      '[email] SMTP not configured (need SMTP_HOST, SMTP_FROM, SMTP_USER, SMTP_PASS); skip send',
    );
    return { sent: false, skipped: true };
  }
  const toAddr = String(to).trim();
  try {
    console.log('[email] sending to:', toAddr);
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: toAddr,
      subject: String(subject || '').slice(0, 200),
      html: String(html || ''),
      text: text != null ? String(text) : stripHtml(html),
    });
    const providerResponse = String(info?.response || '').slice(0, 500);
    console.log('[email] sent successfully', { to: toAddr, providerResponse });
    return { sent: true, providerResponse };
  } catch (error) {
    console.error('[email] failed', error);
    return { sent: false, error: error?.message || String(error) };
  }
}
