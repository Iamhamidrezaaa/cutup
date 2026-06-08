import { createHmac, timingSafeEqual } from 'crypto';
import { EMAIL_CONFIG } from './config';

function secret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || '';
  return String(s).trim() || 'cutup-email-unsubscribe-dev';
}

export function buildUnsubscribeUrl(recipientEmail: string): string {
  const email = String(recipientEmail || '').trim().toLowerCase();
  if (!email) return `${EMAIL_CONFIG.siteUrl}/unsubscribe.html`;
  const sig = createHmac('sha256', secret()).update(email).digest('base64url');
  const token = Buffer.from(`${email}:${sig}`, 'utf8').toString('base64url');
  return `${EMAIL_CONFIG.siteUrl}/unsubscribe.html?token=${encodeURIComponent(token)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const raw = String(token || '').trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const idx = decoded.lastIndexOf(':');
    if (idx <= 0) return null;
    const email = decoded.slice(0, idx).trim().toLowerCase();
    const sig = decoded.slice(idx + 1);
    if (!email || !sig) return null;
    const expected = createHmac('sha256', secret()).update(email).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return email;
  } catch {
    return null;
  }
}
