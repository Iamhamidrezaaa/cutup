/**
 * Distributed singleton guard for Founder Bot Telegram polling.
 * PostgreSQL advisory lock when DATABASE_URL is set; otherwise PM2 instance 0 only.
 */
import { getPool, isBillingDbConfigured } from '../db/pool.js';

/** Stable advisory lock keys (session-scoped while connection is held). */
const POLLING_LOCK_KEY = 1748291034;
const BRIEFING_LOCK_KEY = 1748291035;

const heldClients = new Map();

function isNonLeaderClusterInstance() {
  const raw = process.env.NODE_APP_INSTANCE;
  if (raw == null || raw === '') return false;
  return Number(raw) !== 0;
}

async function tryAcquireAdvisoryLock(lockKey) {
  if (isBillingDbConfigured()) {
    try {
      const client = await getPool().connect();
      const r = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [lockKey]);
      if (!r.rows[0]?.ok) {
        client.release();
        return { acquired: false, release: async () => {} };
      }
      heldClients.set(lockKey, client);
      return {
        acquired: true,
        release: async () => {
          const c = heldClients.get(lockKey);
          if (!c) return;
          heldClients.delete(lockKey);
          try {
            await c.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]);
          } catch (err) {
            console.warn('[founder-bot] lock release failed', err?.message || err);
          } finally {
            c.release();
          }
        }
      };
    } catch (err) {
      console.warn('[founder-bot] lock acquire failed', err?.message || err);
      return { acquired: false, release: async () => {} };
    }
  }

  if (isNonLeaderClusterInstance()) {
    return { acquired: false, release: async () => {} };
  }

  return { acquired: true, release: async () => {} };
}

/**
 * @returns {Promise<{ acquired: boolean, release: () => Promise<void> }>}
 */
export async function tryAcquireFounderBotPollingLock() {
  return tryAcquireAdvisoryLock(POLLING_LOCK_KEY);
}

/**
 * Short-lived lock for daily briefing execution (PM2 cluster singleton).
 * @returns {Promise<{ acquired: boolean, release: () => Promise<void> }>}
 */
export async function tryAcquireFounderBotBriefingLock() {
  return tryAcquireAdvisoryLock(BRIEFING_LOCK_KEY);
}
