/**
 * Normalized transcription provider errors + failover policy helpers.
 */

export class TranscriptionProviderError extends Error {
  /**
   * @param {string} code OPENAI_QUOTA_EXCEEDED | PROVIDER_TIMEOUT | PROVIDER_UNAVAILABLE | INVALID_AUDIO | FILE_TOO_LARGE | TRANSCRIPTION_FAILED | ...
   * @param {string} message
   * @param {{ providerId?: string, httpStatus?: number|null, failoverEligible?: boolean, details?: unknown }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message || code);
    this.name = 'TranscriptionProviderError';
    this.code = code;
    this.providerId = opts.providerId ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    /** When false, router must not advance to the next provider */
    this.failoverEligible = opts.failoverEligible !== false;
    this.details = opts.details ?? null;
  }
}

/** Thrown when every configured provider has been skipped or failed (failover-eligible paths). */
export class AllProvidersFailedError extends Error {
  /**
   * @param {Error|null} lastError
   * @param {string|null} traceId
   * @param {{ attemptedProviders?: string[], lastProviderId?: string|null }} [meta]
   */
  constructor(lastError, traceId = null, meta = {}) {
    super('All transcription providers failed');
    this.name = 'AllProvidersFailedError';
    this.lastError = lastError;
    this.traceId = traceId;
    this.attemptedProviders = meta.attemptedProviders || [];
    this.lastProviderId = meta.lastProviderId || null;
    this.errorCode = 'TRANSCRIPTION_FAILED';
  }
}

/** HTTP statuses where trying another vendor may help */
export function shouldFailoverHttpStatus(status) {
  const s = Number(status);
  if (!Number.isFinite(s)) return true;
  if (s === 408 || s === 429) return true;
  if (s === 402) return true;
  if (s >= 500 && s <= 599) return true;
  return false;
}

/**
 * Client / payload errors where failover usually wastes quota or cannot fix bad media.
 * @param {number} status
 * @param {string} bodySnippet
 */
export function isNonFailoverClientFailure(status, bodySnippet = '') {
  const s = Number(status);
  const m = String(bodySnippet || '').toLowerCase();
  if (s === 413) return true;
  if (s === 415) return true;
  if (s === 400 || s === 422) {
    if (
      /invalid file|invalid audio|unsupported format|cannot decode|decode audio|corrupt|corrupted|empty file|too short|duration|malformed|wrong content|mime/i.test(
        m
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFailoverEligibleError(err) {
  if (!err || typeof err !== 'object') return true;
  const name = /** @type {{ name?: string }} */ (err).name;

  if (name === 'QuotaError') return true;
  if (name === 'OpenAiRateLimitError') return true;
  if (name === 'AuthError') return true;

  if (name === 'TranscriptionProviderError') {
    const fe = /** @type {{ failoverEligible?: boolean }} */ (err).failoverEligible;
    return fe !== false;
  }

  if (name === 'AllProvidersFailedError') return false;

  const code = /** @type {{ code?: string, errorCode?: string }} */ (err).code || /** @type {{ errorCode?: string }} */ (err).errorCode;
  if (code === 'INVALID_AUDIO' || code === 'FILE_TOO_LARGE') return false;

  const c = /** @type {{ code?: string }} */ (err).code;
  if (c === 'ECONNRESET' || c === 'ETIMEDOUT' || c === 'ECONNREFUSED') return true;

  const msg = String(/** @type {{ message?: string }} */ (err).message || '').toLowerCase();
  if (/econnreset|etimedout|timeout|timed out|socket|network|fetch failed/i.test(msg)) return true;

  const status = Number(
    /** @type {{ status?: number, httpStatus?: number }} */ (err).status ??
      /** @type {{ httpStatus?: number }} */ (err).httpStatus ??
      NaN
  );
  if (Number.isFinite(status)) {
    if (isNonFailoverClientFailure(status, msg)) return false;
    if (status >= 400 && status < 500 && !shouldFailoverHttpStatus(status)) return false;
  }

  return true;
}
