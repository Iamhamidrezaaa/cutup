/**
 * Founder Bot — Telegram transport with exponential backoff and auto-recovery.
 * Never throws to callers; polling survives DNS/TLS/timeout/network outages.
 */
import { tryAcquireFounderBotPollingLock } from './polling-lock.js';
import { startDailyBriefingScheduler, stopDailyBriefingScheduler } from './briefing-scheduler.js';
import { recordTelegramSuccess, recordTelegramFailure } from './telegram-health.js';

const TELEGRAM_API = 'https://api.telegram.org';
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const GET_UPDATES_TIMEOUT_MS = 35000;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
const POLL_SUCCESS_DELAY_MS = 200;

let polling = false;
let startingPolling = false;
let pollOffset = 0;
let pollTimer = null;
let pollBackoffIndex = 0;
let pollOnUpdate = null;
let releasePollingLock = null;
let shutdownHooksRegistered = false;
let watchdogTimer = null;

function envToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function envAdminChatId() {
  return String(process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
}

export function isFounderBotConfigured() {
  return Boolean(envToken() && envAdminChatId());
}

export function getFounderBotAdminChatId() {
  return envAdminChatId();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const msg = String(err.message || err).toLowerCase();
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /fetch failed|network|econnreset|econnrefused|enotfound|etimedout|tls|dns|socket/i.test(
      msg
    )
  );
}

/**
 * Single Telegram API attempt (no retry loop).
 */
async function callTelegramApiOnce(method, body = {}, options = {}) {
  const token = envToken();
  if (!token) {
    return { ok: false, skipped: true, reason: 'missing_token' };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const url = `${TELEGRAM_API}/bot${token}/${method}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = data?.description || `HTTP ${res.status}`;
      return { ok: false, error: err, networkError: false };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    console.error('[founder-bot] telegram request error', method, err);
    return {
      ok: false,
      error: err?.message || String(err),
      networkError: isNetworkError(err)
    };
  }
}

/**
 * Telegram API call with exponential backoff on network failures.
 */
async function callTelegramApi(method, body = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? BACKOFF_MS.length + 1;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  let lastResult = { ok: false, error: 'unknown' };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastResult = await callTelegramApiOnce(method, body, { timeoutMs });

    if (lastResult.ok) {
      recordTelegramSuccess();
      return lastResult;
    }

    if (lastResult.skipped) return lastResult;

    const canRetry = lastResult.networkError && attempt < maxAttempts - 1;
    if (canRetry) {
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      await sleep(delay);
      continue;
    }

    break;
  }

  if (lastResult.networkError) {
    recordTelegramFailure();
  }
  return lastResult;
}

function schedulePoll(delayMs) {
  if (!polling) return;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollTimer = setTimeout(() => {
    void pollOnce();
  }, delayMs);
  if (typeof pollTimer.unref === 'function') {
    pollTimer.unref();
  }
}

async function pollOnce() {
  if (!polling || !isFounderBotConfigured() || !pollOnUpdate) return;

  let result;
  try {
    result = await callTelegramApiOnce(
      'getUpdates',
      {
        offset: pollOffset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query']
      },
      { timeoutMs: GET_UPDATES_TIMEOUT_MS }
    );
  } catch (err) {
    console.error('[founder-bot] telegram request error', 'getUpdates', err);
    result = { ok: false, networkError: true, error: err?.message || String(err) };
  }

  if (!polling) return;

  try {
    if (result.ok && Array.isArray(result.result)) {
      pollBackoffIndex = 0;
      recordTelegramSuccess();

      for (const update of result.result) {
        if (update.update_id != null) {
          pollOffset = Math.max(pollOffset, Number(update.update_id) + 1);
        }
        try {
          await pollOnUpdate(update);
        } catch (err) {
          console.warn('[founder-bot] update handler error', err?.message || err);
        }
      }

      schedulePoll(POLL_SUCCESS_DELAY_MS);
      return;
    }

    if (result.networkError) {
      recordTelegramFailure();
    } else if (!result.ok) {
      console.warn('[founder-bot] telegram api failed', 'getUpdates', result.error);
    }

    const delay = BACKOFF_MS[Math.min(pollBackoffIndex, BACKOFF_MS.length - 1)];
    pollBackoffIndex = Math.min(pollBackoffIndex + 1, BACKOFF_MS.length - 1);
    schedulePoll(delay);
  } catch (err) {
    console.error('[founder-bot] poll loop error', err);
    recordTelegramFailure();
    const delay = BACKOFF_MS[Math.min(pollBackoffIndex, BACKOFF_MS.length - 1)];
    pollBackoffIndex = Math.min(pollBackoffIndex + 1, BACKOFF_MS.length - 1);
    schedulePoll(delay);
  }
}

async function runTelegramWatchdog() {
  if (!isFounderBotConfigured()) return;

  try {
    const result = await callTelegramApiOnce('getMe', {}, { timeoutMs: DEFAULT_FETCH_TIMEOUT_MS });
    if (result.ok) {
      recordTelegramSuccess();
      return;
    }
    if (result.networkError) {
      recordTelegramFailure();
    }
    console.warn('[founder-bot] telegram watchdog getMe failed', result.error || 'unknown');
  } catch (err) {
    recordTelegramFailure();
    console.warn('[founder-bot] telegram watchdog getMe failed', err);
  }
}

function startTelegramWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    void runTelegramWatchdog();
  }, WATCHDOG_INTERVAL_MS);
  if (typeof watchdogTimer.unref === 'function') {
    watchdogTimer.unref();
  }
}

function stopTelegramWatchdog() {
  if (!watchdogTimer) return;
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

/**
 * Fire-and-forget message to admin chat. Safe to call from any code path.
 */
export function sendTelegramMessage(text, options = {}) {
  const chatId = options.chatId || envAdminChatId();
  if (!chatId || !envToken()) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'not_configured' });
  }
  const body = {
    chat_id: chatId,
    text: String(text || '').slice(0, 4096),
    disable_web_page_preview: true,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {})
  };
  if (options.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }
  return callTelegramApi('sendMessage', body).catch((err) => {
    console.warn('[founder-bot] sendMessage unexpected', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  });
}

export function editTelegramMessage(chatId, messageId, text, options = {}) {
  if (!chatId || !messageId || !envToken()) {
    return Promise.resolve({ ok: false, skipped: true });
  }
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: String(text || '').slice(0, 4096),
    disable_web_page_preview: true
  };
  if (options.replyMarkup) body.reply_markup = options.replyMarkup;
  return callTelegramApi('editMessageText', body).catch(() => ({ ok: false }));
}

export function answerCallbackQuery(callbackQueryId, options = {}) {
  if (!callbackQueryId || !envToken()) {
    return Promise.resolve({ ok: false, skipped: true });
  }
  return callTelegramApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(options.text ? { text: String(options.text).slice(0, 200) } : {}),
    show_alert: Boolean(options.showAlert)
  }).catch(() => ({ ok: false }));
}

export function queueTelegramMessage(text, options = {}) {
  void sendTelegramMessage(text, options);
}

function registerShutdownHooks() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const onStop = () => {
    stopFounderBotPolling();
    stopDailyBriefingScheduler();
  };
  process.once('SIGTERM', onStop);
  process.once('SIGINT', onStop);
  process.once('beforeExit', onStop);
}

export async function startFounderBotPolling(onUpdate) {
  if (!isFounderBotConfigured()) {
    console.log('[founder-bot] skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set');
    return false;
  }
  if (polling || startingPolling) {
    console.log('[founder-bot] polling skipped (already running)');
    return false;
  }

  startingPolling = true;
  try {
    const lock = await tryAcquireFounderBotPollingLock();
    if (!lock.acquired) {
      console.log('[founder-bot] polling skipped (already running)');
      return false;
    }

    polling = true;
    pollOffset = 0;
    pollBackoffIndex = 0;
    pollOnUpdate = onUpdate;
    releasePollingLock = lock.release;
    registerShutdownHooks();
    console.log('[founder-bot] polling started');
    startDailyBriefingScheduler();
    startTelegramWatchdog();
    void runTelegramWatchdog();
    void pollOnce();
    return true;
  } finally {
    startingPolling = false;
  }
}

export function stopFounderBotPolling() {
  if (!polling && !releasePollingLock) return;
  polling = false;
  pollOnUpdate = null;
  stopDailyBriefingScheduler();
  stopTelegramWatchdog();
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  const release = releasePollingLock;
  releasePollingLock = null;
  if (release) {
    void release().catch(() => {});
  }
}

export async function startFounderBot() {
  const { handleFounderBotUiUpdate } = await import('./ui-handler.js');
  return startFounderBotPolling(handleFounderBotUiUpdate);
}
