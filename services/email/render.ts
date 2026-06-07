import { render } from '@react-email/render';
import * as React from 'react';
import type { EmailTemplateId, RenderedEmail } from './types';
import { EMAIL_TEMPLATES } from './types';
import { getRegistryEntry } from './emailRegistry';
import {
  WelcomeEmail,
  ExportCompleted,
  PaymentReceipt,
  SubscriptionUpgraded,
  UsageWarning80,
  UsageWarning100,
  AccountDeletionRequested,
  AccountDeletionCompleted,
  SupportTicketCreated,
  SupportTicketReply,
  SupportTicketClosed,
  SecurityNotification,
  SystemNotification,
} from '../../emails/templates';

type TemplateComponent = React.ComponentType<Record<string, unknown>>;

const TEMPLATE_COMPONENTS: Record<EmailTemplateId, TemplateComponent> = {
  [EMAIL_TEMPLATES.WELCOME_EMAIL]: WelcomeEmail as TemplateComponent,
  [EMAIL_TEMPLATES.EXPORT_COMPLETED]: ExportCompleted as TemplateComponent,
  [EMAIL_TEMPLATES.PAYMENT_RECEIPT]: PaymentReceipt as TemplateComponent,
  [EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED]: SubscriptionUpgraded as TemplateComponent,
  [EMAIL_TEMPLATES.USAGE_WARNING_80]: UsageWarning80 as TemplateComponent,
  [EMAIL_TEMPLATES.USAGE_WARNING_100]: UsageWarning100 as TemplateComponent,
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED]: AccountDeletionRequested as TemplateComponent,
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED]: AccountDeletionCompleted as TemplateComponent,
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED]: SupportTicketCreated as TemplateComponent,
  [EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY]: SupportTicketReply as TemplateComponent,
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED]: SupportTicketClosed as TemplateComponent,
  [EMAIL_TEMPLATES.SECURITY_NOTIFICATION]: SecurityNotification as TemplateComponent,
  [EMAIL_TEMPLATES.SYSTEM_NOTIFICATION]: SystemNotification as TemplateComponent,
};

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function renderEmailTemplate(
  template: EmailTemplateId,
  data: Record<string, unknown> = {},
): Promise<RenderedEmail> {
  const entry = getRegistryEntry(template);
  const Component = TEMPLATE_COMPONENTS[template];
  if (!Component) throw new Error(`No React component for template: ${template}`);

  const element = React.createElement(Component, data);
  const html = await render(element, { pretty: false });
  const subject = entry.subject(data);
  const preview = entry.preview(data);

  return {
    subject,
    html,
    text: stripHtml(html),
    preview,
  };
}
