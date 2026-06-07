import nodemailer from 'nodemailer';
import { isSmtpConfigured } from '../config';
import type { ProviderSendInput, ProviderSendResult } from './resend';

let transporterPromise: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!transporterPromise) {
    transporterPromise = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporterPromise;
}

export async function sendViaSmtp(input: ProviderSendInput): Promise<ProviderSendResult> {
  const transport = getTransporter();
  if (!transport) return { sent: false, skipped: true };

  try {
    const info = await transport.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject.slice(0, 200),
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, error: (err as Error)?.message || String(err) };
  }
}
