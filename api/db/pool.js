import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function isBillingDbConfigured() {
  return Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
}

export function getPool() {
  if (!isBillingDbConfigured()) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    const ssl =
      process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 20),
      idleTimeoutMillis: 30_000,
      ssl
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
