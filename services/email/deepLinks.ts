import { EMAIL_CONFIG } from './config';

export type EmailDeepLinkTarget =
  | { kind: 'dashboard'; hash?: string }
  | { kind: 'support'; ticketNumber: string }
  | { kind: 'notifications' }
  | { kind: 'billing' }
  | { kind: 'help'; slug?: string };

export function buildEmailDeepLink(target: EmailDeepLinkTarget): string {
  const base = `${EMAIL_CONFIG.siteUrl}/go.html`;
  const params = new URLSearchParams();

  if (target.kind === 'support') {
    params.set('dest', 'support');
    params.set('ticket', String(target.ticketNumber || '').trim());
  } else if (target.kind === 'notifications') {
    params.set('dest', 'notifications');
  } else if (target.kind === 'billing') {
    params.set('dest', 'billing');
  } else if (target.kind === 'help') {
    params.set('dest', 'help');
    if (target.slug) params.set('slug', String(target.slug).trim());
  } else {
    params.set('dest', 'dashboard');
    if (target.hash) params.set('hash', String(target.hash).replace(/^#/, ''));
  }

  return `${base}?${params.toString()}`;
}
