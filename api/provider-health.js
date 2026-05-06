/**
 * Provider metrics & transcription health — implementation lives under ./transcription/
 */
export {
  bumpProviderMetric,
  getProviderHealthSnapshot,
  isProviderTemporarilyDisabled,
  logProviderFailed,
  logProviderFallback,
  logProviderFallbackAttempt,
  logProviderFallbackFinal,
  logProviderHealth,
  logProviderOpenAi,
  logProviderQuota,
  logProviderRateLimit,
  logProviderStart,
  logProviderSuccess,
  logProviderTimeout,
  recordProviderFailure,
  recordProviderSuccess
} from './transcription/provider-health.js';
