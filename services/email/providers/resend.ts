import { EMAIL_CONFIG, isResendConfigured } from '../config';

export type ProviderSendInput = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
};

export type ProviderSendResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  messageId?: string;
};

export async function sendViaResend(input: ProviderSendInput): Promise<ProviderSendResult> {
  if (!isResendConfigured()) {
    return { sent: false, skipped: true };
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const payload: Record<string, unknown> = {
      from: input.from,
      to: [input.to],
      subject: input.subject.slice(0, 200),
      html: input.html,
      text: input.text,
      reply_to: input.replyTo || EMAIL_CONFIG.replyTo,
    };
    if (input.tags?.length) {
      payload.tags = input.tags;
    }

    const result = await resend.emails.send(payload as Parameters<typeof resend.emails.send>[0]);
    if (result.error) {
      return { sent: false, error: result.error.message || String(result.error) };
    }
    return { sent: true, messageId: result.data?.id };
  } catch (err) {
    return { sent: false, error: (err as Error)?.message || String(err) };
  }
}
