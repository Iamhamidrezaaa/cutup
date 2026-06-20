import type { EmailSenderRole } from './types';

const SITE_URL = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export const EMAIL_CONFIG = {
  siteUrl: SITE_URL,
  dashboardUrl: `${SITE_URL}/dashboard.html`,
  supportEmail: 'support@cutup.shop',
  senders: {
    default: 'Cutup <noreply@cutup.shop>',
    billing: 'Cutup Billing <billing@cutup.shop>',
    security: 'Cutup Security <security@cutup.shop>',
    support: 'Cutup Support <support@cutup.shop>',
    hello: 'Cutup <hello@cutup.shop>',
    info: 'Cutup <info@cutup.shop>',
  } satisfies Record<EmailSenderRole, string>,
  contactEmails: {
    default: 'noreply@cutup.shop',
    billing: 'billing@cutup.shop',
    security: 'security@cutup.shop',
    support: 'support@cutup.shop',
    hello: 'hello@cutup.shop',
    info: 'info@cutup.shop',
  } satisfies Record<EmailSenderRole, string>,
  replyTo: 'support@cutup.shop',
} as const;

export function resolveSender(role: EmailSenderRole = 'default'): string {
  return EMAIL_CONFIG.senders[role] || EMAIL_CONFIG.senders.default;
}

export function resolveContactEmail(role: EmailSenderRole = 'default'): string {
  return EMAIL_CONFIG.contactEmails[role] || EMAIL_CONFIG.contactEmails.default;
}

export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return key != null && String(key).trim() !== '';
}

export function isSmtpConfigured(): boolean {
  const required = ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS'];
  return required.every((k) => {
    const v = process.env[k];
    return v != null && String(v).trim() !== '';
  });
}

const PERSONAL_SMTP_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
]);

export function extractEmailAddress(value: string): string {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] || raw).trim().toLowerCase();
}

export function getSmtpAuthEmail(): string | null {
  const user = process.env.SMTP_USER;
  if (user == null || !String(user).trim()) return null;
  return extractEmailAddress(String(user));
}

/** True when SMTP auth can honor the From header (Workspace @cutup.shop or matching domain). */
export function canSmtpSendAs(fromHeader: string): boolean {
  if (!isSmtpConfigured()) return false;

  const fromEmail = extractEmailAddress(fromHeader);
  const authEmail = getSmtpAuthEmail();
  if (!fromEmail || !authEmail) return false;

  const fromDomain = fromEmail.split('@')[1] || '';
  const authDomain = authEmail.split('@')[1] || '';

  if (fromDomain === 'cutup.shop') {
    return authDomain === 'cutup.shop';
  }

  if (PERSONAL_SMTP_DOMAINS.has(authDomain)) {
    return fromEmail === authEmail;
  }

  return fromDomain === authDomain || fromEmail === authEmail;
}

export function getEmailTransportDiagnostics(fromHeader = EMAIL_CONFIG.senders.hello) {
  const from = fromHeader;
  const fromEmail = extractEmailAddress(from);
  const authEmail = getSmtpAuthEmail();
  const resendConfigured = isResendConfigured();
  const smtpConfigured = isSmtpConfigured();
  const smtpCanSendAs = canSmtpSendAs(from);
  const authDomain = authEmail?.split('@')[1] || '';
  const likelyPersonalGmailMisconfiguration =
    Boolean(authEmail) &&
    PERSONAL_SMTP_DOMAINS.has(authDomain) &&
    fromEmail.endsWith('@cutup.shop');

  let recommendation = '';
  if (likelyPersonalGmailMisconfiguration && !resendConfigured) {
    recommendation =
      'Gmail SMTP sends as the authenticated account, not hello@cutup.shop. Set RESEND_API_KEY and verify cutup.shop in Resend.';
  } else if (resendConfigured) {
    recommendation = 'Use Resend for branded @cutup.shop senders.';
  } else if (smtpCanSendAs) {
    recommendation = 'SMTP can send as the template From address.';
  } else if (smtpConfigured) {
    recommendation =
      'SMTP is configured but cannot send as @cutup.shop. Use Resend or Google Workspace for cutup.shop.';
  } else {
    recommendation = 'Configure RESEND_API_KEY (preferred) or SMTP with a @cutup.shop mailbox.';
  }

  return {
    from,
    fromEmail,
    resendConfigured,
    smtpConfigured,
    smtpAuthEmail: authEmail,
    smtpFromEnv: process.env.SMTP_FROM
      ? extractEmailAddress(String(process.env.SMTP_FROM))
      : null,
    smtpCanSendAs,
    likelyPersonalGmailMisconfiguration,
    recommendedProvider: resendConfigured ? 'resend' : smtpCanSendAs ? 'smtp' : null,
    recommendation,
  };
}

export function isEmailPlatformConfigured(): boolean {
  return isResendConfigured() || isSmtpConfigured();
}
