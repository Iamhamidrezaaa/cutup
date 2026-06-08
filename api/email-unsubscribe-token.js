import crypto from 'crypto';

const SITE = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

function secret() {
  return String(process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || '').trim()
    || 'cutup-email-unsubscribe-dev';
}

export function buildUnsubscribeUrl(recipientEmail) {
  const email = String(recipientEmail || '').trim().toLowerCase();
  if (!email) return `${SITE}/unsubscribe.html`;
  const sig = crypto.createHmac('sha256', secret()).update(email).digest('base64url');
  const token = Buffer.from(`${email}:${sig}`, 'utf8').toString('base64url');
  return `${SITE}/unsubscribe.html?token=${encodeURIComponent(token)}`;
}

export function verifyUnsubscribeToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const idx = decoded.lastIndexOf(':');
    if (idx <= 0) return null;
    const email = decoded.slice(0, idx).trim().toLowerCase();
    const sig = decoded.slice(idx + 1);
    if (!email || !sig) return null;
    const expected = crypto.createHmac('sha256', secret()).update(email).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return email;
  } catch {
    return null;
  }
}
