import { sendEmail, isEmailTransportConfigured } from './email.js';

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export function buildDeleteAccountEmail({ first_name, days_with_cutup, deleteLink }) {
  const name = String(first_name || 'there').trim() || 'there';
  const days = Number(days_with_cutup) || 1;
  const link = String(deleteLink || '').trim();

  const subject = 'Before you leave Cutup…';

  const text = `Hi ${name},

We noticed you requested to delete your Cutup account.

Honestly, we're sad to see you go.

You joined Cutup ${days} day${days === 1 ? '' : 's'} ago and we've loved having you with us during that time.

If something didn't work the way you expected, or if there's anything you wish was better, you can always reach out directly:

manager@cutup.shop

I personally read these emails.

If your decision is final, you can permanently delete your account using the secure link below:

${link}

This link expires in 24 hours for security reasons.

And if you ever decide to come back someday, you'll always be welcome here.

Sincerely,
Hamidreza
Founder & CEO — Cutup`;

  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>We noticed you requested to delete your Cutup account.</p>
<p>Honestly, we're sad to see you go.</p>
<p>You joined Cutup <strong>${days}</strong> day${days === 1 ? '' : 's'} ago and we've loved having you with us during that time.</p>
<p>If something didn't work the way you expected, or if there's anything you wish was better, you can always reach out directly:<br>
<a href="mailto:manager@cutup.shop">manager@cutup.shop</a></p>
<p><em>I personally read these emails.</em></p>
<p>If your decision is final, you can permanently delete your account using the secure link below:</p>
<p style="margin:24px 0"><a href="${escapeAttr(link)}" style="display:inline-block;padding:12px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:10px;font-weight:600">Confirm account deletion</a></p>
<p style="font-size:14px;color:#64748b">Or copy this link:<br><a href="${escapeAttr(link)}">${escapeHtml(link)}</a></p>
<p style="font-size:14px;color:#64748b">This link expires in 24 hours for security reasons.</p>
<p>And if you ever decide to come back someday, you'll always be welcome here.</p>
<p>Sincerely,<br>
<strong>Hamidreza</strong><br>
Founder &amp; CEO — Cutup</p>`;

  return { subject, html, text };
}

export async function sendDeleteAccountConfirmationEmail(ctx, rawToken) {
  const deleteLink = `${FRONTEND_URL}/delete-account.html?token=${encodeURIComponent(rawToken)}`;
  const { subject, html, text } = buildDeleteAccountEmail({
    first_name: ctx.first_name,
    days_with_cutup: ctx.days_with_cutup,
    deleteLink
  });
  if (!isEmailTransportConfigured()) {
    console.warn('[delete-email-sent] skipped — SMTP not configured');
    return { sent: false, skipped: true, deleteLink };
  }
  const out = await sendEmail({ to: ctx.email, subject, html, text });
  if (out.sent) {
    console.log('[delete-email-sent]', { to: ctx.email });
  }
  return { ...out, deleteLink };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
