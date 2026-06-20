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
  OFFER_PROMOTION: 'Offer Promotion',
  FIRST_PROJECT_FOLLOW_UP: 'First Project Follow-Up',
};

function goLink(params) {
  const q = new URLSearchParams(params);
  return `${SITE_URL}/go.html?${q.toString()}`;
}

const sample = {
  firstName: 'Alex',
  projectName: 'Product Demo Reel',
  exportType: 'MP4',
  exportDate: 'Jun 2, 2026',
  downloadUrl: goLink({ dest: 'dashboard' }),
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
  agentAvatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Sara&backgroundColor=635bff,e0e7ff,f5f3ff&fontSize=42',
  agentJobTitle: 'Customer Success',
  replyText: 'Thanks for reaching out — we fixed the issue on your account.',
  ticketUrl: goLink({ dest: 'support', ticket: '1042' }),
  cancelUrl: goLink({ dest: 'profile' }),
  cooldownDays: 30,
  title: 'New sign-in detected',
  message: 'A new sign-in was detected on your Cutup account.',
};

const EMAIL_REGISTRY_META = {
  WELCOME_EMAIL: {
    template: 'WELCOME_EMAIL',
    subject: () => 'Welcome to Cutup',
    preview: () => 'Welcome to Cutup — your AI video workspace',
    senderRole: 'hello',
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
  SUBSCRIPTION_EXPIRED: {
    template: 'SUBSCRIPTION_EXPIRED',
    subject: () => 'Your Cutup subscription has ended',
    preview: () => 'Your subscription has ended — renew to keep access',
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      planName: sample.planName,
      amount: sample.amount,
      payUrl: sample.downloadUrl,
    },
    event: 'subscription_expired',
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
      ticketUrl: sample.ticketUrl,
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
      agentAvatarUrl: sample.agentAvatarUrl,
      agentJobTitle: sample.agentJobTitle,
      replyText: sample.replyText,
      ticketUrl: sample.ticketUrl,
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
      ticketUrl: sample.ticketUrl,
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
      ticketUrl: sample.ticketUrl,
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
    senderRole: 'info',
    sampleData: {
      firstName: sample.firstName,
      title: 'Scheduled maintenance',
      message: 'Cutup will undergo brief maintenance on Sunday at 02:00 UTC.',
    },
  },
  OFFER_PROMOTION: {
    template: 'OFFER_PROMOTION',
    subject: (d) => {
      const discount = String(d.discountLabel || '20% off');
      const target = String(d.targetPlanName || 'Pro');
      return `Your ${discount} upgrade to ${target} is ready`;
    },
    preview: (d) => {
      const discount = String(d.discountLabel || '20% off');
      const target = String(d.targetPlanName || 'Pro');
      return `${discount} to upgrade to ${target} — limited-time offer`;
    },
    senderRole: 'billing',
    sampleData: {
      firstName: sample.firstName,
      sourcePlanName: 'Free',
      targetPlanName: 'Pro',
      discountLabel: '20% off',
      couponCode: 'CUTUPXHWDJ',
      expiresLabel: '26 Jun 2026',
      campaignTitle: 'New Users upgrade push',
      checkoutUrl: goLink({ dest: 'checkout', plan: 'pro', coupon: 'CUTUPXHWDJ', source: 'offer_email' }),
      upgradeHighlights: [
        { bold: '35 videos per month', rest: ' — up from 3 on Free' },
        { bold: 'AI Translation', rest: ' for multilingual captions' },
        { bold: 'MP4 export', rest: ' with burned-in captions' },
        { bold: 'Premium caption styles', rest: ' built for TikTok & YouTube' },
        { bold: 'Priority export queue', rest: '' },
      ],
    },
  },
  FIRST_PROJECT_FOLLOW_UP: {
    template: 'FIRST_PROJECT_FOLLOW_UP',
    subject: () => 'Nice work on your first transcript',
    preview: () => "Thanks for trying CutUp — explore what's next with your free credits",
    senderRole: 'hello',
    sampleData: {
      firstName: sample.firstName,
      dashboardUrl: goLink({ dest: 'dashboard' }),
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
