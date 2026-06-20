import { getPool, isBillingDbConfigured } from './db/pool.js';
import { inferFirstNameFromEmail } from './offer-email-content.js';

export async function resolveEmailRecipientData(email, overrides = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const out = {
    email: normalizedEmail,
    firstName: inferFirstNameFromEmail(normalizedEmail),
    lastName: '',
    planName: 'free',
    userFound: false,
  };

  if (!normalizedEmail || !isBillingDbConfigured()) {
    return { ...out, ...overrides };
  }

  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT u.email,
              up.first_name,
              up.last_name,
              lower(coalesce(s.plan, 'free')) AS plan
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE lower(u.email) = lower($1)
       LIMIT 1`,
      [normalizedEmail]
    );
    const row = r.rows?.[0];
    if (row) {
      out.userFound = true;
      out.email = String(row.email || normalizedEmail).trim().toLowerCase();
      out.firstName = String(row.first_name || '').trim() || inferFirstNameFromEmail(row.email);
      out.lastName = String(row.last_name || '').trim();
      out.planName = String(row.plan || 'free').trim().toLowerCase();
    }
  } catch (_e) {
    /* fall back to inferred name */
  }

  return { ...out, ...overrides };
}
