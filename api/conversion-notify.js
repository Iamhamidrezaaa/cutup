import { sendEmail } from './email.js';
import {
  insertAnalyticsEvent,
  isBillingDbConfigured,
  logConversionEmailSent,
  resolveUserIdForAnalytics,
  wasConversionEmailSentRecently,
} from './billing-repository.js';

const BASE_URL = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

function trackingUrl(kind) {
  const t = encodeURIComponent(String(kind || '').slice(0, 32));
  return `${BASE_URL}/?cutup_ec=1&t=${t}#tool`;
}

function templateHtml({ headline, body, ctaLabel, kind }) {
  const url = trackingUrl(kind);
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.55;color:#0f172a;background:#f8fafc">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px 24px">
    <tr><td>
      <p style="margin:0 0 12px;font-size:18px;font-weight:700">${headline}</p>
      <p style="margin:0 0 20px;color:#475569">${body}</p>
      <a href="${url}" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${ctaLabel}</a>
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Cutup — <a href="${url}" style="color:#6366f1">Open the tool</a></p>
    </td></tr>
  </table>
</body>
</html>`;
}

const TEMPLATES = {
  lead_ready: {
    subject: 'Your subtitles are ready — go grab them',
    headline: 'Your subtitles are ready — go grab them',
    body: 'They’re sitting in Cutup waiting for you—pop in, tweak if you want, and export.',
    cta: 'Open the tool',
  },
  abandon_pay: {
    subject: 'Want faster + full access? Unlock it here',
    headline: 'Pick up where you left off',
    body: 'You were a tap away from the full workflow—no stress, finish checkout when you’re ready.',
    cta: 'Unlock it',
  },
  active_use: {
    subject: 'You’re on a roll with Cutup',
    headline: 'You’re crushing it with Cutup',
    body: 'If you want more headroom and faster runs, snag a plan that matches your pace.',
    cta: 'See what fits',
  },
};

async function recordEmailSentAnalytics(email, kind) {
  if (!isBillingDbConfigured()) return;
  try {
    const userId = await resolveUserIdForAnalytics(email);
    await insertAnalyticsEvent({
      userId,
      guestId: null,
      event: 'email_sent',
      variant: 'A',
      plan: String(kind).slice(0, 32),
    });
  } catch (_e) {
    /* noop */
  }
}

/**
 * Sends one conversion email if under 24h cap and SMTP is configured.
 * @param {{ email: string, kind: 'lead_ready'|'abandon_pay'|'active_use' }} opts
 */
export async function sendConversionEmailIfAllowed({ email, kind }) {
  const em = String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, 320);
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    return { ok: false, reason: 'invalid_email' };
  }
  const spec = TEMPLATES[kind];
  if (!spec) return { ok: false, reason: 'unknown_kind' };

  if (await wasConversionEmailSentRecently(em, 24)) {
    return { ok: false, reason: 'rate_limited' };
  }

  const html = templateHtml({
    headline: spec.headline,
    body: spec.body,
    ctaLabel: spec.cta,
    kind,
  });

  const result = await sendEmail({ to: em, subject: spec.subject, html });
  if (!result.sent) {
    return { ok: false, reason: result.skipped ? 'transport_disabled' : 'send_failed', detail: result.error };
  }

  await logConversionEmailSent(em, kind);
  await recordEmailSentAnalytics(em, kind);
  return { ok: true };
}
