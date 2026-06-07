/**
 * Future-ready email platform hooks — NOT implemented yet.
 * Architecture stubs for localization, analytics, tracking, preferences, notification center.
 */

export type EmailLocale = 'en' | 'fa' | string;

export type EmailAnalyticsContext = {
  templateId: string;
  eventName?: string;
  userId?: string;
  campaignId?: string;
  locale?: EmailLocale;
};

/** Reserved: resolve localized template variant */
export function resolveLocalizedTemplate(_templateId: string, _locale: EmailLocale): string {
  return _templateId;
}

/** Reserved: record send/open/click metrics */
export async function trackEmailEvent(
  _event: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced',
  _ctx: EmailAnalyticsContext,
  _meta?: Record<string, unknown>,
): Promise<void> {
  /* future: Resend webhooks + email_events table */
}

/** Reserved: per-user notification preferences */
export async function shouldSendToUser(
  _userId: string,
  _templateId: string,
  _channel: 'email' | 'in_app' = 'email',
): Promise<boolean> {
  return true;
}

/** Reserved: in-app notification center feed */
export async function pushNotificationCenterItem(_payload: Record<string, unknown>): Promise<void> {
  /* future */
}

/** Reserved: unsubscribe / preference center link */
export function buildPreferenceCenterUrl(_userId: string): string {
  const base = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');
  return `${base}/dashboard.html#profile`;
}
