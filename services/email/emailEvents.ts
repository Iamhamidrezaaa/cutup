import { EMAIL_REGISTRY } from './emailRegistry';
import { sendEmail } from './sendEmail';
import {
  EMAIL_EVENTS,
  EMAIL_TEMPLATES,
  type EmailEventName,
  type EmailTemplateId,
} from './types';

export type EmailEventPayload = Record<string, unknown> & {
  email: string;
  firstName?: string;
};

type EventHandler = (payload: EmailEventPayload) => Promise<void>;

const handlers = new Map<EmailEventName, EventHandler[]>();

/** Map events → default templates */
const EVENT_TEMPLATE_MAP: Partial<Record<EmailEventName, EmailTemplateId>> = {
  [EMAIL_EVENTS.USER_REGISTERED]: EMAIL_TEMPLATES.WELCOME_EMAIL,
  [EMAIL_EVENTS.EXPORT_COMPLETED]: EMAIL_TEMPLATES.EXPORT_COMPLETED,
  [EMAIL_EVENTS.PAYMENT_SUCCESSFUL]: EMAIL_TEMPLATES.PAYMENT_RECEIPT,
  [EMAIL_EVENTS.SUBSCRIPTION_UPGRADED]: EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED,
  [EMAIL_EVENTS.CREDITS_80_PERCENT]: EMAIL_TEMPLATES.USAGE_WARNING_80,
  [EMAIL_EVENTS.CREDITS_EXHAUSTED]: EMAIL_TEMPLATES.USAGE_WARNING_100,
  [EMAIL_EVENTS.ACCOUNT_DELETION_REQUESTED]: EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED,
  [EMAIL_EVENTS.ACCOUNT_DELETED]: EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED,
  [EMAIL_EVENTS.TICKET_CREATED]: EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED,
  [EMAIL_EVENTS.TICKET_REPLIED]: EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY,
  [EMAIL_EVENTS.TICKET_CLOSED]: EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED,
};

export function onEmailEvent(event: EmailEventName, handler: EventHandler): void {
  const list = handlers.get(event) || [];
  list.push(handler);
  handlers.set(event, list);
}

/**
 * Emit a domain event — triggers registered handlers + default template send.
 * Business logic should call this instead of sendEmail directly.
 */
export async function emitEmailEvent(
  event: EmailEventName,
  payload: EmailEventPayload,
): Promise<{ ok: boolean; results: Awaited<ReturnType<typeof sendEmail>>[] }> {
  const results: Awaited<ReturnType<typeof sendEmail>>[] = [];

  const template = EVENT_TEMPLATE_MAP[event];
  if (template && payload.email) {
    const { email, firstName, ...rest } = payload;
    const data = { firstName, ...rest };
    const out = await sendEmail({ template, recipient: email, data });
    results.push(out);
  }

  const customHandlers = handlers.get(event) || [];
  for (const handler of customHandlers) {
    try {
      await handler(payload);
    } catch (err) {
      console.error('[email-events] handler failed', event, err);
    }
  }

  return { ok: results.every((r) => r.sent || r.skipped), results };
}

/** Register built-in handlers from registry metadata (extensibility hook). */
export function registerDefaultEmailEventHandlers(): void {
  for (const entry of Object.values(EMAIL_REGISTRY)) {
    if (!entry.event) continue;
    onEmailEvent(entry.event, async () => {
      /* default send handled in emitEmailEvent */
    });
  }
}

export { EMAIL_EVENTS, EMAIL_TEMPLATES };
