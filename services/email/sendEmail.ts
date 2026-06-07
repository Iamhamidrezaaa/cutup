import { resolveSender, isEmailPlatformConfigured, isResendConfigured } from './config';
import { getRegistryEntry } from './emailRegistry';
import { renderEmailTemplate } from './render';
import { sendViaResend } from './providers/resend';
import { sendViaSmtp } from './providers/smtp';
import { recordEmailSendLog } from './sendLog';
import type { SendEmailInput, SendEmailResult } from './types';

/**
 * Central email send API — all product emails go through this function.
 * Business logic must NOT call Resend/SMTP directly.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { template, recipient, data = {}, senderRole, tags } = input;
  const to = String(recipient || '').trim();

  if (!to) {
    return { sent: false, error: 'missing_recipient', template };
  }

  if (!isEmailPlatformConfigured()) {
    console.warn('[email-platform] transport not configured; skip send', { template, to });
    const skippedResult: SendEmailResult = {
      sent: false,
      skipped: true,
      template,
      to,
    };
    await recordEmailSendLog(skippedResult);
    return skippedResult;
  }

  const entry = getRegistryEntry(template);
  const rendered = await renderEmailTemplate(template, data);
  const from = resolveSender(senderRole || entry.senderRole);

  const providerInput = {
    from,
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: tags?.map((t) => ({ name: 'cutup', value: t })),
  };

  console.log('[email-platform] send attempt', {
    template,
    from,
    to,
    subject: rendered.subject,
    htmlLength: rendered.html?.length ?? 0,
  });

  let result;
  let provider: 'resend' | 'smtp' = 'smtp';

  if (isResendConfigured()) {
    provider = 'resend';
    result = await sendViaResend(providerInput);
    if (!result.sent && !result.skipped) {
      console.warn('[email-platform] Resend failed, trying SMTP fallback', result.error);
      result = await sendViaSmtp(providerInput);
      provider = 'smtp';
    }
  } else {
    result = await sendViaSmtp(providerInput);
  }

  if (result.sent) {
    console.log('[email-platform] sent', {
      template,
      from,
      to,
      subject: rendered.subject,
      htmlLength: rendered.html?.length ?? 0,
      provider,
      messageId: result.messageId,
      resendResponse: result.resendResponse,
    });
  } else if (!result.skipped) {
    console.error('[email-platform] failed', {
      template,
      from,
      to,
      subject: rendered.subject,
      htmlLength: rendered.html?.length ?? 0,
      error: result.error,
      resendResponse: result.resendResponse,
    });
  } else {
    console.warn('[email-platform] skipped', { template, from, to, reason: 'transport_not_configured' });
  }

  const sendResult: SendEmailResult = {
    sent: Boolean(result.sent),
    skipped: result.skipped,
    error: result.error,
    provider: result.sent ? provider : undefined,
    messageId: result.messageId,
    template,
    from,
    to,
    subject: rendered.subject,
    htmlLength: rendered.html?.length ?? 0,
    resendResponse: result.resendResponse,
  };

  await recordEmailSendLog(sendResult);
  return sendResult;
}
