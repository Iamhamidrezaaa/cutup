/** Cutup email platform — core types. */

export const EMAIL_TEMPLATES = {
  WELCOME_EMAIL: 'WELCOME_EMAIL',
  EXPORT_COMPLETED: 'EXPORT_COMPLETED',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
  SUBSCRIPTION_UPGRADED: 'SUBSCRIPTION_UPGRADED',
  USAGE_WARNING_80: 'USAGE_WARNING_80',
  USAGE_WARNING_100: 'USAGE_WARNING_100',
  ACCOUNT_DELETION_REQUESTED: 'ACCOUNT_DELETION_REQUESTED',
  ACCOUNT_DELETION_COMPLETED: 'ACCOUNT_DELETION_COMPLETED',
  SUPPORT_TICKET_CREATED: 'SUPPORT_TICKET_CREATED',
  SUPPORT_TICKET_REPLY: 'SUPPORT_TICKET_REPLY',
  SUPPORT_TICKET_CLOSED: 'SUPPORT_TICKET_CLOSED',
  SECURITY_NOTIFICATION: 'SECURITY_NOTIFICATION',
  SYSTEM_NOTIFICATION: 'SYSTEM_NOTIFICATION',
} as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATES)[keyof typeof EMAIL_TEMPLATES];

/**
 * Event → template trigger map (business emits event; platform sends email).
 *
 * user_registered              → WELCOME_EMAIL
 * export_completed             → EXPORT_COMPLETED
 * payment_successful           → PAYMENT_RECEIPT
 * subscription_upgraded        → SUBSCRIPTION_UPGRADED
 * credits_80_percent           → USAGE_WARNING_80
 * credits_exhausted            → USAGE_WARNING_100
 * account_deletion_requested   → ACCOUNT_DELETION_REQUESTED
 * account_deleted              → ACCOUNT_DELETION_COMPLETED
 * ticket_created               → SUPPORT_TICKET_CREATED
 * ticket_replied               → SUPPORT_TICKET_REPLY
 * ticket_closed                → SUPPORT_TICKET_CLOSED
 */
export const EMAIL_EVENTS = {
  USER_REGISTERED: 'user_registered',
  EXPORT_COMPLETED: 'export_completed',
  PAYMENT_SUCCESSFUL: 'payment_successful',
  SUBSCRIPTION_UPGRADED: 'subscription_upgraded',
  CREDITS_80_PERCENT: 'credits_80_percent',
  CREDITS_EXHAUSTED: 'credits_exhausted',
  ACCOUNT_DELETION_REQUESTED: 'account_deletion_requested',
  ACCOUNT_DELETED: 'account_deleted',
  TICKET_CREATED: 'ticket_created',
  TICKET_REPLIED: 'ticket_replied',
  TICKET_CLOSED: 'ticket_closed',
} as const;

export type EmailEventName = (typeof EMAIL_EVENTS)[keyof typeof EMAIL_EVENTS];

export type EmailSenderRole = 'default' | 'billing' | 'security' | 'support';

export type SendEmailInput<T extends EmailTemplateId = EmailTemplateId> = {
  template: T;
  recipient: string;
  data?: Record<string, unknown>;
  /** Override sender role from registry */
  senderRole?: EmailSenderRole;
  /** Optional idempotency key for deduplication */
  idempotencyKey?: string;
  /** Locale code — reserved for future i18n */
  locale?: string;
  /** Tags for future analytics */
  tags?: string[];
};

export type SendEmailResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  provider?: 'resend' | 'smtp';
  messageId?: string;
  template: EmailTemplateId;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  preview: string;
};

export type EmailRegistryEntry = {
  template: EmailTemplateId;
  subject: (data: Record<string, unknown>) => string;
  preview: (data: Record<string, unknown>) => string;
  senderRole: EmailSenderRole;
  sampleData: Record<string, unknown>;
  event?: EmailEventName;
};
