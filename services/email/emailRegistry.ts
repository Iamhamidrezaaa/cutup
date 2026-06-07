import { EMAIL_CONFIG } from './config';
import { EMAIL_EVENTS, EMAIL_TEMPLATES, type EmailRegistryEntry, type EmailTemplateId } from './types';

const sample = {
  firstName: 'Alex',
  projectName: 'Product Demo Reel',
  exportType: 'MP4',
  exportDate: 'Jun 2, 2026',
  downloadUrl: `${EMAIL_CONFIG.dashboardUrl}`,
  amount: '€19.00',
  planName: 'Pro',
  paymentDate: 'Jun 2, 2026',
  monthlyCredits: 50,
  used: 40,
  remaining: 10,
  limit: 50,
  ticketNumber: '1042',
  subject: 'Export not downloading',
  createdAt: 'Jun 2, 2026',
  agentName: 'Sara',
  replyText: 'Thanks for reaching out — we fixed the issue on your account.',
  cancelUrl: `${EMAIL_CONFIG.dashboardUrl}`,
  cooldownDays: 30,
  title: 'New sign-in detected',
  message: 'A new sign-in was detected on your Cutup account.',
};

/** Template metadata — subjects, senders, sample data, event mapping. */
export const EMAIL_REGISTRY: Record<EmailTemplateId, EmailRegistryEntry> = {
  [EMAIL_TEMPLATES.WELCOME_EMAIL]: {
    template: EMAIL_TEMPLATES.WELCOME_EMAIL,
    subject: () => 'Welcome to Cutup',
    preview: () => 'Welcome to Cutup — your AI video workspace',
    senderRole: 'default',
    sampleData: { firstName: sample.firstName },
    event: EMAIL_EVENTS.USER_REGISTERED,
  },
  [EMAIL_TEMPLATES.EXPORT_COMPLETED]: {
    template: EMAIL_TEMPLATES.EXPORT_COMPLETED,
    subject: () => 'Your export is ready',
    preview: () => 'Your export is ready',
    senderRole: 'default',
    sampleData: {
      projectName: sample.projectName,
      exportType: sample.exportType,
      exportDate: sample.exportDate,
      downloadUrl: sample.downloadUrl,
    },
    event: EMAIL_EVENTS.EXPORT_COMPLETED,
  },
  [EMAIL_TEMPLATES.PAYMENT_RECEIPT]: {
    template: EMAIL_TEMPLATES.PAYMENT_RECEIPT,
    subject: () => 'Payment received',
    preview: () => 'Payment received — thank you',
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      amount: sample.amount,
      planName: sample.planName,
      paymentDate: sample.paymentDate,
    },
    event: EMAIL_EVENTS.PAYMENT_SUCCESSFUL,
  },
  [EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED]: {
    template: EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED,
    subject: (d) => `Welcome to ${String(d.planName || 'Pro')}`,
    preview: (d) => `Welcome to ${String(d.planName || 'Pro')}`,
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      planName: sample.planName,
      monthlyCredits: sample.monthlyCredits,
    },
    event: EMAIL_EVENTS.SUBSCRIPTION_UPGRADED,
  },
  [EMAIL_TEMPLATES.USAGE_WARNING_80]: {
    template: EMAIL_TEMPLATES.USAGE_WARNING_80,
    subject: () => '80% of monthly credits used',
    preview: () => '80% of monthly credits used',
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      used: 40,
      remaining: 10,
      limit: 50,
    },
    event: EMAIL_EVENTS.CREDITS_80_PERCENT,
  },
  [EMAIL_TEMPLATES.USAGE_WARNING_100]: {
    template: EMAIL_TEMPLATES.USAGE_WARNING_100,
    subject: () => '100% of monthly credits used',
    preview: () => '100% of monthly credits used',
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      used: 50,
      remaining: 0,
      limit: 50,
    },
    event: EMAIL_EVENTS.CREDITS_EXHAUSTED,
  },
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED]: {
    template: EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED,
    subject: () => 'Your Cutup account deletion request',
    preview: () => 'Your Cutup account deletion request',
    senderRole: 'security',
    sampleData: {
      firstName: sample.firstName,
      cancelUrl: sample.cancelUrl,
      cooldownDays: sample.cooldownDays,
    },
    event: EMAIL_EVENTS.ACCOUNT_DELETION_REQUESTED,
  },
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED]: {
    template: EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED,
    subject: () => 'Your Cutup account has been deleted',
    preview: () => 'Your Cutup account has been deleted',
    senderRole: 'security',
    sampleData: {
      firstName: sample.firstName,
      cooldownDays: sample.cooldownDays,
    },
    event: EMAIL_EVENTS.ACCOUNT_DELETED,
  },
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED]: {
    template: EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED,
    subject: (d) => `Ticket #${String(d.ticketNumber || '0000')} received`,
    preview: (d) => `Ticket #${String(d.ticketNumber || '0000')} received`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject,
      createdAt: sample.createdAt,
    },
    event: EMAIL_EVENTS.TICKET_CREATED,
  },
  [EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY]: {
    template: EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY,
    subject: (d) => `Update on Ticket #${String(d.ticketNumber || '0000')}`,
    preview: (d) => `Update on Ticket #${String(d.ticketNumber || '0000')}`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      agentName: sample.agentName,
      replyText: sample.replyText,
    },
    event: EMAIL_EVENTS.TICKET_REPLIED,
  },
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED]: {
    template: EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED,
    subject: (d) => `Ticket #${String(d.ticketNumber || '0000')} resolved`,
    preview: (d) => `Ticket #${String(d.ticketNumber || '0000')} resolved`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject,
    },
    event: EMAIL_EVENTS.TICKET_CLOSED,
  },
  [EMAIL_TEMPLATES.SECURITY_NOTIFICATION]: {
    template: EMAIL_TEMPLATES.SECURITY_NOTIFICATION,
    subject: (d) => String(d.title || 'Security notification'),
    preview: (d) => String(d.title || 'Security notification'),
    senderRole: 'security',
    sampleData: {
      firstName: sample.firstName,
      title: sample.title,
      message: sample.message,
    },
  },
  [EMAIL_TEMPLATES.SYSTEM_NOTIFICATION]: {
    template: EMAIL_TEMPLATES.SYSTEM_NOTIFICATION,
    subject: (d) => String(d.title || 'Cutup update'),
    preview: (d) => String(d.title || 'Cutup update'),
    senderRole: 'default',
    sampleData: {
      firstName: sample.firstName,
      title: 'Scheduled maintenance',
      message: 'Cutup will undergo brief maintenance on Sunday at 02:00 UTC.',
    },
  },
};

export function getRegistryEntry(template: EmailTemplateId): EmailRegistryEntry {
  const entry = EMAIL_REGISTRY[template];
  if (!entry) throw new Error(`Unknown email template: ${template}`);
  return entry;
}

export function listAllTemplates(): EmailRegistryEntry[] {
  return Object.values(EMAIL_REGISTRY);
}
