export async function markAsRead(userId: string, notificationId: number) {
  const mod = await import('../../api/notifications-repository.js');
  return mod.markNotificationReadDb(userId, notificationId);
}
