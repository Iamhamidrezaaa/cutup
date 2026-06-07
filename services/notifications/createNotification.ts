import type { CreateNotificationInput, NotificationRecord } from './types';
import { defaultNotificationProvider } from './NotificationProvider';

export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ ok: boolean; notification?: NotificationRecord; reason?: string }> {
  const userId = String(input.userId || '').trim();
  if (!userId) return { ok: false, reason: 'missing_user_id' };

  const mod = await import('../../api/notifications-repository.js');
  const result = await mod.insertNotification({
    userId,
    type: input.type,
    title: input.title,
    message: input.message,
    metadata: input.metadata || {},
  });

  if (!result.ok || !result.notification) {
    return { ok: false, reason: result.reason || 'insert_failed' };
  }

  await defaultNotificationProvider.deliverInApp(result.notification, userId);
  return { ok: true, notification: result.notification };
}
