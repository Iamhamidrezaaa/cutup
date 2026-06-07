export async function getUnreadCount(userId: string) {
  const mod = await import('../../api/notifications-repository.js');
  return mod.countUnreadNotificationsDb(userId);
}
