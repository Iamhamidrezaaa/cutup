/**
 * Platform role separation: panel admins vs end-user customers.
 * Centralizes checks — avoid scattered email comparisons in routes/UI.
 */
import { isBillingDbConfigured, getPool } from './db/pool.js';

/** Roles stored in `admins.role` (extend CHECK when adding DB values). */
export const PLATFORM_ADMIN_ROLES = Object.freeze([
  'super_admin',
  'admin',
  'editor',
  'support_admin'
]);

export const CUSTOMER_ROLE = 'customer';

/**
 * @param {string} [email]
 * @returns {Promise<{ id: number, email: string, role: string, status: string } | null>}
 */
export async function getActiveAdminByEmail(email) {
  if (!isBillingDbConfigured()) return null;
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, email, role, status
     FROM admins
     WHERE lower(email) = $1 AND status = 'active'
     LIMIT 1`,
    [em]
  );
  return r.rows[0] || null;
}

/** @param {string} [email] */
export async function isAdminUser(email) {
  return Boolean(await getActiveAdminByEmail(email));
}

/**
 * @param {{ role?: string } | null} adminRow
 * @returns {string} platform role slug (customer when not an admin)
 */
export function platformRoleFromAdminRow(adminRow) {
  if (!adminRow) return CUSTOMER_ROLE;
  const role = String(adminRow.role || '').trim().toLowerCase();
  if (PLATFORM_ADMIN_ROLES.includes(role)) return role;
  return 'admin';
}

/** @param {string} [platformRole] */
export function isCustomerUser(platformRole) {
  const r = String(platformRole || CUSTOMER_ROLE).toLowerCase();
  return !r || r === CUSTOMER_ROLE;
}

/** Customer-only surfaces (dashboard, billing UI, free plan). */
export function requiresCustomerRole(platformRole) {
  return isCustomerUser(platformRole);
}

/** Panel routes (adminha, /api/admin/*). */
export function isAdminRoute(pathname) {
  const p = String(pathname || '').toLowerCase();
  return (
    p.includes('adminha') ||
    p.includes('admin-forgot') ||
    p.includes('admin-reset') ||
    p.startsWith('/api/admin')
  );
}

/** @param {string} [pathname] */
export function isCustomerRoute(pathname) {
  const p = String(pathname || '').toLowerCase();
  if (isAdminRoute(p)) return false;
  return (
    p.includes('dashboard') ||
    p.endsWith('/checkout') ||
    p.includes('checkout.html') ||
    p.includes('payment-success')
  );
}
