/**
 * Distributed singleton guard for Founder Bot Telegram polling.
 * PostgreSQL advisory lock when DATABASE_URL is set; otherwise PM2 instance 0 only.
 */
import { getPool, isBillingDbConfigured } from '../db/pool.js';

/** Stable advisory lock key (session-scoped while connection is held). */
const ADVISORY_LOCK_KEY = 1748291034;

let heldClient = null;

function isNonLeaderClusterInstance() {
  const raw = process.env.NODE_APP_INSTANCE;
  if (raw == null || raw === '') return false;
  return Number(raw) !== 0;
}

/**
 * @returns {Promise<{ acquired: boolean, release: () => Promise<void> }>}
 */
export async function tryAcquireFounderBotPollingLock() {
  if (isBillingDbConfigured()) {
    try {
      const client = await getPool().connect();
      const r = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [
        ADVISORY_LOCK_KEY
      ]);
      if (!r.rows[0]?.ok) {
        client.release();
        return { acquired: false, release: async () => {} };
      }
      heldClient = client;
      return {
        acquired: true,
        release: async () => {
          if (!heldClient) return;
          const c = heldClient;
          heldClient = null;
          try {
            await c.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]);
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
