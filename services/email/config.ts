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

export function isEmailPlatformConfigured(): boolean {
  return isResendConfigured() || isSmtpConfigured();
}
