import type { SendEmailResult } from './types';

export async function recordEmailSendLog(
  result: SendEmailResult,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const mod = await import('../../api/email-platform/send-log-bridge.js');
    await mod.logEmailSendResult(result, extra);
  } catch (err) {
    console.warn('[email-platform] email_send_log persist failed', (err as Error)?.message || err);
  }
}
