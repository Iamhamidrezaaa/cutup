import { notificationIcon } from './icons';
import type { ListNotificationsInput, NotificationRecord } from './types';

export type NotificationListItem = NotificationRecord & { icon: string };

export async function getNotifications(input: ListNotificationsInput) {
  const mod = await import('../../api/notifications-repository.js');
  const result = await mod.listNotificationsDb({
    userId: input.userId,
    page: input.page,
    limit: input.limit,
    filter: input.filter || 'all',
  });
  if (!result.ok) return result;
  return {
    ...result,
    notifications: result.notifications.map((n: NotificationRecord) => ({
      ...n,
      icon: notificationIcon(n.type),
    })),
  };
}
