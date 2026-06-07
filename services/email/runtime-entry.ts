/**
 * Bundled runtime entry for Vercel API (api/email-platform/index.js).
 */
export { sendEmail } from './sendEmail';
export { renderEmailTemplate } from './render';
export { EMAIL_REGISTRY, getRegistryEntry, listAllTemplates } from './emailRegistry';
export { emitEmailEvent, onEmailEvent, registerDefaultEmailEventHandlers, EMAIL_EVENTS, EMAIL_TEMPLATES } from './emailEvents';
export { EMAIL_CONFIG, isEmailPlatformConfigured, isResendConfigured, isSmtpConfigured } from './config';
export type { SendEmailInput, SendEmailResult, EmailTemplateId, EmailEventName } from './types';
