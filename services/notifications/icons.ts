import type { NotificationType } from './types';

const ICONS: Record<NotificationType, string> = {
  WELCOME: '👋',
  EXPORT_COMPLETED: '🎬',
  PAYMENT_RECEIVED: '💳',
  SUBSCRIPTION_UPGRADED: '🚀',
  USAGE_WARNING_80: '⚠️',
  USAGE_WARNING_100: '⚠️',
  ACCOUNT_DELETION_REQUESTED: '⚠️',
  ACCOUNT_DELETED: '⚠️',
  SUPPORT_TICKET_CREATED: '🎫',
  SUPPORT_TICKET_REPLY: '🎫',
  SUPPORT_TICKET_CLOSED: '🎫',
  SECURITY_ALERT: '🔒',
  SYSTEM_NOTIFICATION: '⚙️',
};

export function notificationIcon(type: NotificationType): string {
  return ICONS[type] || '⚙️';
}
