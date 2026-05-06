/**
 * Immutable transcription provider registry — single source of truth at runtime.
 * Never mutate returned arrays; rebuild from env if snapshot is empty.
 */

import {
  OPENAI_PROVIDER_ID,
  GROQ_PROVIDER_ID,
  DEEPGRAM_PROVIDER_ID,
  LOCAL_WHISPER_PROVIDER_ID
} from './provider-ids.js';

export const TRANSCRIPTION_PROVIDER_ORDER = Object.freeze([
  OPENAI_PROVIDER_ID,
  GROQ_PROVIDER_ID,
  DEEPGRAM_PROVIDER_ID,
  LOCAL_WHISPER_PROVIDER_ID
]);

const MIN_KEY_LEN = 10;

/** @type {{ env: Readonly<Record<string, boolean>>, activeProviders: readonly string[], fallbackProviders: readonly string[], fallbackOrder: readonly string[] } | null} */
let frozenRegistry = null;

export function isTranscriptionProviderConfigured(id) {
  switch (id) {
    case OPENAI_PROVIDER_ID:
      return Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).length >= MIN_KEY_LEN);
    case GROQ_PROVIDER_ID:
      return Boolean(process.env.GROQ_API_KEY && String(process.env.GROQ_API_KEY).length >= MIN_KEY_LEN);
    case DEEPGRAM_PROVIDER_ID:
      return Boolean(process.env.DEEPGRAM_API_KEY && String(process.env.DEEPGRAM_API_KEY).length >= MIN_KEY_LEN);
    case LOCAL_WHISPER_PROVIDER_ID:
      return process.env.WHISPER_LOCAL_ENABLED === 'true';
    default:
      return false;
  }
}

/** Build fresh lists from process.env (never returns aliased mutable singletons). */
export function buildProviderListsFromEnv() {
  const fallbackOrder = TRANSCRIPTION_PROVIDER_ORDER.filter((id) => isTranscriptionProviderConfigured(id));
  const activeProviders = [...fallbackOrder];
  const fallbackProviders = activeProviders.filter((id) => id !== OPENAI_PROVIDER_ID);
  const env = Object.freeze({
    openai: isTranscriptionProviderConfigured(OPENAI_PROVIDER_ID),
    groq: isTranscriptionProviderConfigured(GROQ_PROVIDER_ID),
    deepgram: isTranscriptionProviderConfigured(DEEPGRAM_PROVIDER_ID),
    localWhisper: isTranscriptionProviderConfigured(LOCAL_WHISPER_PROVIDER_ID)
  });
  return {
    env,
    activeProviders: Object.freeze(activeProviders),
    fallbackProviders: Object.freeze(fallbackProviders),
    fallbackOrder: Object.freeze(fallbackOrder)
  };
}

function freezeRegistry(snapshot) {
  frozenRegistry = Object.freeze({
    env: snapshot.env,
    activeProviders: snapshot.activeProviders,
    fallbackProviders: snapshot.fallbackProviders,
    fallbackOrder: snapshot.fallbackOrder
  });
  return frozenRegistry;
}

/**
 * Rebuild registry from env. Call at server boot and whenever runtime lists are empty.
 */
export function refreshTranscriptionProviderRegistry(reason = 'refresh') {
  const snapshot = buildProviderListsFromEnv();
  freezeRegistry(snapshot);
  console.log('[provider-runtime]', {
    reason,
    activeProviders: [...snapshot.activeProviders],
    fallbackProviders: [...snapshot.fallbackProviders],
    fallbackOrder: [...snapshot.fallbackOrder]
  });
  if (snapshot.fallbackProviders.length === 0 && snapshot.activeProviders.length > 0) {
    console.warn(
      '⚠️  [provider-runtime] No backup providers in registry — only primary is active. Set GROQ_API_KEY and/or DEEPGRAM_API_KEY.'
    );
  }
  return frozenRegistry;
}

export function getFrozenTranscriptionRegistry() {
  if (!frozenRegistry) {
    return refreshTranscriptionProviderRegistry('lazy_init');
  }
  return frozenRegistry;
}

/** Hard safety: never return empty when env has keys. */
function ensureNonEmptyLists(lists, reason) {
  const activeLen = lists.activeProviders.length;
  const fbLen = lists.fallbackProviders.length;
  if (activeLen === 0 || (activeLen > 1 && fbLen === 0)) {
    console.warn('[provider-runtime]', {
      reason,
      message: 'Registry lists empty or missing fallbacks — rebuilding from env',
      hadActive: activeLen,
      hadFallback: fbLen
    });
    return refreshTranscriptionProviderRegistry(`rebuild_${reason}`);
  }
  return lists;
}

export function getRuntimeTranscriptionCandidates(traceId = null) {
  let reg = getFrozenTranscriptionRegistry();
  reg = ensureNonEmptyLists(reg, 'candidates');
  const candidates = [...reg.fallbackOrder];
  console.log('[provider-selection]', {
    traceId,
    candidates,
    activeProviders: [...reg.activeProviders],
    fallbackProviders: [...reg.fallbackProviders]
  });
  if (candidates.length === 0) {
    console.error('❌ [provider-selection] FATAL: candidates still empty after env rebuild', {
      traceId,
      env: { ...reg.env }
    });
  }
  return candidates;
}

export function getRuntimeFallbackProviders(traceId = null) {
  let reg = getFrozenTranscriptionRegistry();
  reg = ensureNonEmptyLists(reg, 'fallback_only');
  const fallback = [...reg.fallbackProviders];
  if (fallback.length === 0) {
    const rebuilt = buildProviderListsFromEnv();
    const fromEnv = [...rebuilt.fallbackProviders];
    if (fromEnv.length > 0) {
      console.warn('[provider-runtime]', { traceId, message: 'Recovered fallbackProviders from env', fromEnv });
      freezeRegistry(rebuilt);
      return fromEnv;
    }
  }
  return fallback;
}

export function getTranscriptionEnvStatus() {
  return { ...getFrozenTranscriptionRegistry().env };
}

export function listConfiguredTranscriptionProviders() {
  return getRuntimeTranscriptionCandidates(null);
}
