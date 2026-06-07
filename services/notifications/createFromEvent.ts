import { buildNotificationFromEvent, type ProductEventPayload } from './eventMap';
import { createNotification } from './createNotification';

export async function createNotificationFromEvent(event: string, payload: ProductEventPayload) {
  const draft = buildNotificationFromEvent(event, payload);
  if (!draft) return { ok: false, reason: 'unsupported_event' };

  let userId = String(payload.userId || '').trim();
  if (!userId && payload.email) {
    const { getUserIdByEmail } = await import('../../api/billing-repository.js');
    userId = (await getUserIdByEmail(String(payload.email).trim())) || '';
  }
  if (!userId) return { ok: false, reason: 'missing_user_id' };

  return createNotification({
    userId,
    type: draft.type,
    title: draft.title,
    message: draft.message,
    metadata: { ...draft.metadata, email: payload.email || null },
  });
}
