/**
 * Founder Bot — Telegram transport with retries. Never throws to callers.
 */
import { tryAcquireFounderBotPollingLock } from './polling-lock.js';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 800;

let polling = false;
let startingPolling = false;
let pollOffset = 0;
let pollTimer = null;
let releasePollingLock = null;
let shutdownHooksRegistered = false;

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

async function callTelegramApi(method, body = {}, attempt = 1) {
  const token = envToken();
  if (!token) {
    return { ok: false, skipped: true, reason: 'missing_token' };
  }

  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = data?.description || `HTTP ${res.status}`;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * attempt);
        return callTelegramApi(method, body, attempt + 1);
      }
      console.warn('[founder-bot] telegram api failed', method, err);
      return { ok: false, error: err };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_MS * attempt);
      return callTelegramApi(method, body, attempt + 1);
    }
    console.warn('[founder-bot] telegram request error', method, err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
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
  return callTelegramApi('sendMessage', body).catch((err) => {
    console.warn('[founder-bot] sendMessage unexpected', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  });
}

export function queueTelegramMessage(text, options = {}) {
  void sendTelegramMessage(text, options);
}

function registerShutdownHooks() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const onStop = () => stopFounderBotPolling();
  process.once('SIGTERM', onStop);
  process.once('SIGINT', onStop);
  process.once('beforeExit', onStop);
}

async function pollOnce(onUpdate) {
  if (!polling || !isFounderBotConfigured()) return;

  const result = await callTelegramApi('getUpdates', {
    offset: pollOffset,
    timeout: 25,
    allowed_updates: ['message']
  });

  if (!polling) return;

  if (result.ok && Array.isArray(result.result)) {
    for (const update of result.result) {
      if (update.update_id != null) {
        pollOffset = Math.max(pollOffset, Number(update.update_id) + 1);
      }
      try {
        await onUpdate(update);
      } catch (err) {
        console.warn('[founder-bot] update handler error', err?.message || err);
      }
    }
  }

  if (polling) {
    pollTimer = setTimeout(() => {
      void pollOnce(onUpdate);
    }, result.ok ? 200 : 3000);
  }
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
    releasePollingLock = lock.release;
    registerShutdownHooks();
    console.log('[founder-bot] polling started');
    void pollOnce(onUpdate);
    return true;
  } finally {
    startingPolling = false;
  }
}

export function stopFounderBotPolling() {
  if (!polling && !releasePollingLock) return;
  polling = false;
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
  const { handleTelegramUpdate } = await import('./commands.js');
  return startFounderBotPolling(handleTelegramUpdate);
}
