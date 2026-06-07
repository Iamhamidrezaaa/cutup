export async function markAllAsRead(userId: string) {
  const mod = await import('../../api/notifications-repository.js');
  return mod.markAllNotificationsReadDb(userId);
}
