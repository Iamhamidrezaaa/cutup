/**
 * Lightweight email registry (no React) — list/preview metadata for admin API.
 * Source of truth for IDs remains services/email/emailRegistry.ts (bundled into email-platform).
 */
const SITE_URL = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export const TEMPLATE_DISPLAY_NAMES = {
  WELCOME_EMAIL: 'Welcome Email',
  EXPORT_COMPLETED: 'Export Completed',
  PAYMENT_RECEIPT: 'Payment Receipt',
  SUBSCRIPTION_UPGRADED: 'Subscription Upgraded',
  USAGE_WARNING_80: 'Usage Warning 80%',
  USAGE_WARNING_100: 'Usage Warning 100%',
  ACCOUNT_DELETION_REQUESTED: 'Account Deletion Requested',
  ACCOUNT_DELETION_COMPLETED: 'Account Deletion Completed',
  SUPPORT_TICKET_CREATED: 'Support Ticket Created',
  SUPPORT_TICKET_REPLY: 'Support Ticket Reply',
  SUPPORT_TICKET_CLOSED: 'Support Ticket Closed',
  SECURITY_NOTIFICATION: 'Security Notification',
  SYSTEM_NOTIFICATION: 'System Notification',
};

const sample = {
  firstName: 'Alex',
  projectName: 'Product Demo Reel',
  exportType: 'MP4',
  exportDate: 'Jun 2, 2026',
  downloadUrl: `${SITE_URL}/dashboard.html`,
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
  cancelUrl: `${SITE_URL}/dashboard.html`,
  cooldownDays: 30,
  title: 'New sign-in detected',
  message: 'A new sign-in was detected on your Cutup account.',
};

const EMAIL_REGISTRY_META = {
  WELCOME_EMAIL: {
    template: 'WELCOME_EMAIL',
    subject: () => 'Welcome to Cutup',
    preview: () => 'Welcome to Cutup — your AI video workspace',
    senderRole: 'default',
    sampleData: { firstName: sample.firstName },
    event: 'user_registered',
  },
  EXPORT_COMPLETED: {
    template: 'EXPORT_COMPLETED',
    subject: () => 'Your export is ready',
    preview: () => 'Your export is ready',
    senderRole: 'default',
    sampleData: {
      projectName: sample.projectName,
      exportType: sample.exportType,
      exportDate: sample.exportDate,
      downloadUrl: sample.downloadUrl,
    },
    event: 'export_completed',
  },
  PAYMENT_RECEIPT: {
    template: 'PAYMENT_RECEIPT',
    subject: () => 'Payment received',
    preview: () => 'Payment received — thank you',
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      amount: sample.amount,
      planName: sample.planName,
      paymentDate: sample.paymentDate,
    },
    event: 'payment_successful',
  },
  SUBSCRIPTION_UPGRADED: {
    template: 'SUBSCRIPTION_UPGRADED',
    subject: (d) => `Welcome to ${String(d.planName || 'Pro')}`,
    preview: (d) => `Welcome to ${String(d.planName || 'Pro')}`,
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      planName: sample.planName,
      monthlyCredits: sample.monthlyCredits,
    },
    event: 'subscription_upgraded',
  },
  USAGE_WARNING_80: {
    template: 'USAGE_WARNING_80',
    subject: () => '80% of monthly credits used',
    preview: () => '80% of monthly credits used',
    senderRole: 'billing',
    sampleData: { firstName: sample.firstName, used: 40, remaining: 10, limit: 50 },
    event: 'credits_80_percent',
  },
  USAGE_WARNING_100: {
    template: 'USAGE_WARNING_100',
    subject: () => '100% of monthly credits used',
    preview: () => '100% of monthly credits used',
    senderRole: 'billing',
    sampleData: { firstName: sample.firstName, used: 50, remaining: 0, limit: 50 },
    event: 'credits_exhausted',
  },
  ACCOUNT_DELETION_REQUESTED: {
    template: 'ACCOUNT_DELETION_REQUESTED',
    subject: () => 'Your Cutup account deletion request',
    preview: () => 'Your Cutup account deletion request',
    senderRole: 'security',
    sampleData: {
      firstName: sample.firstName,
      cancelUrl: sample.cancelUrl,
      cooldownDays: sample.cooldownDays,
    },
    event: 'account_deletion_requested',
  },
  ACCOUNT_DELETION_COMPLETED: {
    template: 'ACCOUNT_DELETION_COMPLETED',
    subject: () => 'Your Cutup account has been deleted',
    preview: () => 'Your Cutup account has been deleted',
    senderRole: 'security',
    sampleData: { firstName: sample.firstName, cooldownDays: sample.cooldownDays },
    event: 'account_deleted',
  },
  SUPPORT_TICKET_CREATED: {
    template: 'SUPPORT_TICKET_CREATED',
    subject: (d) => `Ticket #${String(d.ticketNumber || '0000')} received`,
    preview: (d) => `Ticket #${String(d.ticketNumber || '0000')} received`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject,
      createdAt: sample.createdAt,
    },
    event: 'ticket_created',
  },
  SUPPORT_TICKET_REPLY: {
    template: 'SUPPORT_TICKET_REPLY',
    subject: (d) => `Update on Ticket #${String(d.ticketNumber || '0000')}`,
    preview: (d) => `Update on Ticket #${String(d.ticketNumber || '0000')}`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      agentName: sample.agentName,
      replyText: sample.replyText,
    },
    event: 'ticket_replied',
  },
  SUPPORT_TICKET_RESOLVED: {
    template: 'SUPPORT_TICKET_RESOLVED',
    subject: (d) => `Ticket #${String(d.ticketNumber || '0000')} resolved`,
    preview: (d) => `Ticket #${String(d.ticketNumber || '0000')} resolved`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject,
    },
    event: 'ticket_resolved',
  },
  SUPPORT_TICKET_CLOSED: {
    template: 'SUPPORT_TICKET_CLOSED',
    subject: (d) => `Ticket #${String(d.ticketNumber || '0000')} closed`,
    preview: (d) => `Ticket #${String(d.ticketNumber || '0000')} closed`,
    senderRole: 'support',
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject,
    },
    event: 'ticket_closed',
  },
  SECURITY_NOTIFICATION: {
    template: 'SECURITY_NOTIFICATION',
    subject: (d) => String(d.title || 'Security notification'),
    preview: (d) => String(d.title || 'Security notification'),
    senderRole: 'security',
    sampleData: { firstName: sample.firstName, title: sample.title, message: sample.message },
  },
  SYSTEM_NOTIFICATION: {
    template: 'SYSTEM_NOTIFICATION',
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

export function listRegistryMeta() {
  return Object.values(EMAIL_REGISTRY_META);
}

export function getRegistryMetaEntry(templateId) {
  return EMAIL_REGISTRY_META[templateId] || null;
}

export function formatTemplateForApi(entry) {
  const id = entry.template;
  return {
    id,
    name: TEMPLATE_DISPLAY_NAMES[id] || id,
    template: id,
    senderRole: entry.senderRole,
    event: entry.event || null,
    sampleSubject: entry.subject(entry.sampleData || {}),
    sampleData: entry.sampleData || {},
  };
}
