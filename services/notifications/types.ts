export const NOTIFICATION_TYPES = {
  WELCOME: 'WELCOME',
  EXPORT_COMPLETED: 'EXPORT_COMPLETED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  SUBSCRIPTION_UPGRADED: 'SUBSCRIPTION_UPGRADED',
  USAGE_WARNING_80: 'USAGE_WARNING_80',
  USAGE_WARNING_100: 'USAGE_WARNING_100',
  ACCOUNT_DELETION_REQUESTED: 'ACCOUNT_DELETION_REQUESTED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  SUPPORT_TICKET_CREATED: 'SUPPORT_TICKET_CREATED',
  SUPPORT_TICKET_REPLY: 'SUPPORT_TICKET_REPLY',
  SUPPORT_TICKET_CLOSED: 'SUPPORT_TICKET_CLOSED',
  SECURITY_ALERT: 'SECURITY_ALERT',
  SYSTEM_NOTIFICATION: 'SYSTEM_NOTIFICATION',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationRecord = {
  id: number;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type ListNotificationsFilter = 'all' | 'unread' | 'read';

export type ListNotificationsInput = {
  userId: string;
  page?: number;
  limit?: number;
  filter?: ListNotificationsFilter;
};
