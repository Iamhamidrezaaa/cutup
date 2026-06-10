/**
 * Transcription provider registry + startup diagnostics (call once from server.js).
 */
import {
  refreshTranscriptionProviderRegistry,
  getFrozenTranscriptionRegistry,
  getTranscriptionEnvStatus,
  buildProviderListsFromEnv
} from './registry.js';

let bootLogged = false;

function printStartupBanner(env, active, fallbackOrder) {
  const line = (name, key) => {
    const on = env[key];
    return `${name}: ${on ? 'ACTIVE' : 'INACTIVE'}`;
  };
  console.log('================================');
  console.log('TRANSCRIPTION PROVIDERS');
  console.log('================================');
  console.log(line('OpenAI', 'openai'));
  console.log(line('Groq', 'groq'));
  console.log(line('Deepgram', 'deepgram'));
  if (env.localWhisper) {
    console.log('Local Whisper: ENABLED (scaffold)');
  }
  console.log('Fallback order:');
  fallbackOrder.forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });
  if (active.length === 0) {
    console.error('⚠️  NO transcription providers are configured.');
  } else if (fallbackOrder.length <= 1) {
    console.warn(
      '⚠️  WARNING: No backup transcription providers — set OPENAI_API_KEY and/or DEEPGRAM_API_KEY for failover.'
    );
  }
  console.log('================================');
}

/**
 * Register providers from env and emit diagnostics. Idempotent; refreshes frozen snapshot.
 */
export function initTranscriptionProviders() {
  const reg = refreshTranscriptionProviderRegistry('startup');
  const env = getTranscriptionEnvStatus();
  const activeProviders = [...reg.activeProviders];
  const fallbackProviders = [...reg.fallbackProviders];
  const fallbackOrder = [...reg.fallbackOrder];

  if (!bootLogged) {
    console.log('[provider-env]', JSON.stringify({ openai: env.openai, groq: env.groq, deepgram: env.deepgram }));
    console.log('[provider-init]', { activeProviders, fallbackProviders });
    printStartupBanner(env, activeProviders, fallbackOrder);

    if (activeProviders.length === 0) {
      console.error(
        '❌ [provider-init] FATAL: No transcription providers. Set OPENAI_API_KEY, GROQ_API_KEY, and/or DEEPGRAM_API_KEY.'
      );
    } else if (fallbackProviders.length === 0) {
      console.warn(
        '⚠️  [provider-init] Fallback architecture is loaded but NO backup providers are active. Groq quota/outage will fail requests until OPENAI_API_KEY or DEEPGRAM_API_KEY is set.'
      );
    }
    bootLogged = true;
  }

  return {
    env,
    activeProviders,
    fallbackProviders,
    fallbackOrder,
    primaryProviderId: reg.primaryProviderId,
    primaryModel: reg.primaryModel
  };
}

export function ensureTranscriptionProvidersInit() {
  return initTranscriptionProviders();
}

export function getTranscriptionProviderRegistry() {
  const reg = getFrozenTranscriptionRegistry();
  return {
    env: getTranscriptionEnvStatus(),
    activeProviders: [...reg.activeProviders],
    fallbackProviders: [...reg.fallbackProviders],
    fallbackOrder: [...reg.fallbackOrder],
    primaryProviderId: reg.primaryProviderId,
    primaryModel: reg.primaryModel
  };
}

/** @deprecated use getTranscriptionProviderRegistry — kept for imports */
export function getActiveTranscriptionProviders() {
  return [...getFrozenTranscriptionRegistry().activeProviders];
}

export function getTranscriptionFallbackProviders() {
  return [...getFrozenTranscriptionRegistry().fallbackProviders];
}

export { buildProviderListsFromEnv, getTranscriptionEnvStatus };
