import { NOTIFICATION_TYPES, type NotificationType } from './types';

export type ProductEventPayload = Record<string, unknown> & {
  email?: string;
  userId?: string;
  firstName?: string;
};

type NotificationDraft = {
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export function buildNotificationFromEvent(
  event: string,
  payload: ProductEventPayload,
): NotificationDraft | null {
  const first = String(payload.firstName || 'there').trim() || 'there';

  switch (event) {
    case 'user_registered':
      return {
        type: NOTIFICATION_TYPES.WELCOME,
        title: 'Welcome to Cutup',
        message: `Hi ${first}, your AI video workspace is ready.`,
        metadata: { event, href: '/dashboard.html#overview' },
      };
    case 'export_completed':
      return {
        type: NOTIFICATION_TYPES.EXPORT_COMPLETED,
        title: 'Export ready',
        message: `${payload.projectName || 'Your project'} (${payload.exportType || 'MP4'}) is ready to download.`,
        metadata: {
          event,
          projectName: payload.projectName,
          exportType: payload.exportType,
          downloadUrl: payload.downloadUrl,
        },
      };
    case 'payment_successful':
      return {
        type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
        title: 'Payment confirmed',
        message: `We received your ${payload.amount || 'payment'} for ${payload.planName || 'your plan'}.`,
        metadata: {
          event,
          amount: payload.amount,
          planName: payload.planName,
          invoiceUrl: payload.invoiceUrl,
        },
      };
    case 'subscription_upgraded':
      return {
        type: NOTIFICATION_TYPES.SUBSCRIPTION_UPGRADED,
        title: `You're now on ${payload.planName || 'Pro'}`,
        message: `Your plan was upgraded. Enjoy more credits and premium features.`,
        metadata: {
          event,
          planName: payload.planName,
          monthlyCredits: payload.monthlyCredits,
        },
      };
    case 'credits_80_percent':
      return {
        type: NOTIFICATION_TYPES.USAGE_WARNING_80,
        title: 'Approaching monthly limit',
        message: `You've used ${payload.used ?? 0} of ${payload.limit ?? 0} credits this cycle.`,
        metadata: {
          event,
          used: payload.used,
          remaining: payload.remaining,
          limit: payload.limit,
          href: '/dashboard.html#subscription',
        },
      };
    case 'credits_exhausted':
      return {
        type: NOTIFICATION_TYPES.USAGE_WARNING_100,
        title: 'Monthly credits exhausted',
        message: `You've used all credits on your current plan. Upgrade to continue.`,
        metadata: {
          event,
          used: payload.used,
          remaining: payload.remaining,
          limit: payload.limit,
          href: '/dashboard.html#subscription',
        },
      };
    case 'account_deletion_requested':
      return {
        type: NOTIFICATION_TYPES.ACCOUNT_DELETION_REQUESTED,
        title: 'Account deletion scheduled',
        message: 'Your account is scheduled for deletion. You can cancel from your dashboard.',
        metadata: {
          event,
          cancelUrl: payload.cancelUrl,
          cooldownDays: payload.cooldownDays,
        },
      };
    case 'account_deleted':
      return {
        type: NOTIFICATION_TYPES.ACCOUNT_DELETED,
        title: 'Account deleted',
        message: 'Your Cutup account has been permanently removed.',
        metadata: { event, cooldownDays: payload.cooldownDays },
      };
    case 'ticket_created':
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_CREATED,
        title: `Ticket #${payload.ticketNumber || '—'} created`,
        message: payload.subject
          ? `We received: ${payload.subject}`
          : 'Your support request was received.',
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          subject: payload.subject,
          ticketUrl: payload.ticketUrl,
        },
      };
    case 'ticket_replied':
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY,
        title: `Reply on ticket #${payload.ticketNumber || '—'}`,
        message: `${payload.agentName || 'Support'} responded to your ticket.`,
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          agentName: payload.agentName,
          ticketUrl: payload.ticketUrl,
        },
      };
    case 'ticket_closed':
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_CLOSED,
        title: `Ticket #${payload.ticketNumber || '—'} resolved`,
        message: payload.subject
          ? `"${payload.subject}" was marked resolved.`
          : 'Your support ticket was closed.',
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          subject: payload.subject,
          ratingUrl: payload.ratingUrl,
        },
      };
    case 'security_notification':
      return {
        type: NOTIFICATION_TYPES.SECURITY_ALERT,
        title: String(payload.title || 'Security alert'),
        message: String(payload.message || 'A security event occurred on your account.'),
        metadata: {
          event,
          actionUrl: payload.actionUrl,
          actionLabel: payload.actionLabel,
        },
      };
    case 'system_notification':
      return {
        type: NOTIFICATION_TYPES.SYSTEM_NOTIFICATION,
        title: String(payload.title || 'Cutup update'),
        message: String(payload.message || 'You have a new system notification.'),
        metadata: {
          event,
          ctaUrl: payload.ctaUrl,
          ctaLabel: payload.ctaLabel,
        },
      };
    default:
      return null;
  }
}
