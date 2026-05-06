import { TranscriptionProviderError } from '../errors.js';
import { LOCAL_WHISPER_PROVIDER_ID } from '../provider-ids.js';

export { LOCAL_WHISPER_PROVIDER_ID };

/**
 * Scaffold for whisper.cpp / local inference (WHISPER_LOCAL_ENABLED=true).
 * Not wired yet — fails fast without consuming downstream quota when disabled.
 */
export async function transcribeLocalWhisper(ctx) {
  const enabled = process.env.WHISPER_LOCAL_ENABLED === 'true';
  if (!enabled) {
    throw new TranscriptionProviderError(
      'PROVIDER_UNAVAILABLE',
      'Local Whisper is disabled',
      {
        providerId: LOCAL_WHISPER_PROVIDER_ID,
        failoverEligible: true,
        details: { traceId: ctx.traceId }
      }
    );
  }

  throw new TranscriptionProviderError(
    'PROVIDER_UNAVAILABLE',
    'Local whisper.cpp runner is not installed yet (scaffold only)',
    {
      providerId: LOCAL_WHISPER_PROVIDER_ID,
      httpStatus: 501,
      failoverEligible: true,
      details: {
        traceId: ctx.traceId,
        hint: 'Set WHISPER_LOCAL_BINARY / wiring in local-whisper-provider when ready'
      }
    }
  );
}
