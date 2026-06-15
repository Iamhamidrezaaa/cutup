/** @type {Map<string, { kind: string, value: string }>} */
const lastActionByChat = new Map();

export function setLastAction(chatId, action) {
  if (!chatId || !action?.kind) return;
  lastActionByChat.set(String(chatId), action);
}

export function getLastAction(chatId) {
  return lastActionByChat.get(String(chatId)) || null;
}

export function founderAdminDisplayName(from) {
  const envName = String(process.env.TELEGRAM_ADMIN_NAME || '').trim();
  if (envName) return envName;
  const first = String(from?.first_name || '').trim();
  if (first) return first;
  return 'Founder';
}
