/**
 * Founder Bot V1.4 — daily executive briefing scheduler (09:00 server local time).
 */
import { tryAcquireFounderBotBriefingLock } from './polling-lock.js';
import { isFounderBotConfigured, sendTelegramMessage } from './telegram.js';
import { buildBriefingText } from './metrics-v14.js';

const BRIEFING_HOUR = 9;
const BRIEFING_MINUTE = 0;
const CHECK_INTERVAL_MS = 60_000;

let schedulerTimer = null;
let schedulerStarted = false;
let lastSentDateKey = null;

function todayDateKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isBriefingWindow(d = new Date()) {
  return d.getHours() === BRIEFING_HOUR && d.getMinutes() === BRIEFING_MINUTE;
}

export async function sendDailyBriefing() {
  if (!isFounderBotConfigured()) {
    return { ok: false, skipped: true, reason: 'not_configured' };
  }

  const lock = await tryAcquireFounderBotBriefingLock();
  if (!lock.acquired) {
    return { ok: false, skipped: true, reason: 'not_leader' };
  }

  try {
    const text = await buildBriefingText();
    const result = await sendTelegramMessage(text);
    if (result.ok) {
      console.log('[founder-bot] daily briefing sent');
      return { ok: true };
    }
    console.log('[founder-bot] daily briefing failed');
    return { ok: false, error: result.error || result.reason };
  } catch (err) {
    console.log('[founder-bot] daily briefing failed');
    return { ok: false, error: err?.message || String(err) };
  } finally {
    await lock.release().catch(() => {});
  }
}

async function tickBriefingScheduler() {
  if (!isFounderBotConfigured()) return;

  const now = new Date();
  const key = todayDateKey(now);
  if (isBriefingWindow(now) && lastSentDateKey !== key) {
    lastSentDateKey = key;
    void sendDailyBriefing();
  }
}

export function startDailyBriefingScheduler() {
  if (schedulerStarted) return false;
  if (!isFounderBotConfigured()) return false;

  schedulerStarted = true;
  schedulerTimer = setInterval(() => {
    void tickBriefingScheduler();
  }, CHECK_INTERVAL_MS);

  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }

  console.log('[founder-bot] daily briefing scheduler started');
  return true;
}

export function stopDailyBriefingScheduler() {
  if (!schedulerStarted) return;
  schedulerStarted = false;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
