import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureOperationsV3Schema } from './operations-bootstrap.js';

const ROLE_SEEDS = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full platform access' },
  { code: 'SUPPORT_ADMIN', name: 'Support Admin', description: 'Support center operations' },
  { code: 'BILLING_ADMIN', name: 'Billing Admin', description: 'Billing and subscriptions' },
  { code: 'CONTENT_ADMIN', name: 'Content Admin', description: 'CMS and knowledge base' },
  { code: 'READ_ONLY_ADMIN', name: 'Read Only Admin', description: 'View-only admin access' },
];

const PERMISSION_SEEDS = [
  { code: 'support.view', name: 'View support tickets', module: 'support' },
  { code: 'support.reply', name: 'Reply to tickets', module: 'support' },
  { code: 'support.assign', name: 'Assign tickets', module: 'support' },
  { code: 'support.status', name: 'Change ticket status', module: 'support' },
  { code: 'support.notes', name: 'Internal notes', module: 'support' },
  { code: 'billing.view', name: 'View billing', module: 'billing' },
  { code: 'content.manage', name: 'Manage content', module: 'content' },
  { code: 'help.manage', name: 'Manage help articles', module: 'help' },
  { code: 'admin.users', name: 'Manage admins', module: 'admin' },
];

const ROLE_PERMISSION_MAP = {
  SUPER_ADMIN: PERMISSION_SEEDS.map((p) => p.code),
  SUPPORT_ADMIN: ['support.view', 'support.reply', 'support.assign', 'support.status', 'support.notes'],
  BILLING_ADMIN: ['billing.view', 'support.view'],
  CONTENT_ADMIN: ['content.manage', 'help.manage'],
  READ_ONLY_ADMIN: ['support.view', 'billing.view'],
};

let rbacSeeded = false;

export async function ensureRbacSeed() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureOperationsV3Schema();
  if (rbacSeeded) return { ok: true, cached: true };

  const pool = getPool();
  for (const role of ROLE_SEEDS) {
    await pool.query(
      `INSERT INTO roles (code, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [role.code, role.name, role.description],
    );
  }
  for (const perm of PERMISSION_SEEDS) {
    await pool.query(
      `INSERT INTO permissions (code, name, module) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, module = EXCLUDED.module`,
      [perm.code, perm.name, perm.module],
    );
  }

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSION_MAP)) {
    const roleRes = await pool.query(`SELECT id FROM roles WHERE code = $1`, [roleCode]);
    const roleId = roleRes.rows[0]?.id;
    if (!roleId) continue;
    for (const permCode of permCodes) {
      const permRes = await pool.query(`SELECT id FROM permissions WHERE code = $1`, [permCode]);
      const permId = permRes.rows[0]?.id;
      if (!permId) continue;
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [roleId, permId],
      );
    }
  }

  rbacSeeded = true;
  return { ok: true };
}

export async function getAdminPermissions(adminId) {
  if (!isBillingDbConfigured()) return [];
  await ensureRbacSeed();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT p.code
     FROM admin_roles ar
     JOIN role_permissions rp ON rp.role_id = ar.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ar.admin_id = $1`,
    [Number(adminId)],
  );
  return rows.map((r) => r.code);
}

export async function adminHasPermission(adminId, permissionCode) {
  const perms = await getAdminPermissions(adminId);
  if (perms.includes(permissionCode)) return true;
  // Legacy fallback: admins without explicit roles keep full support access
  if (!perms.length) return true;
  return false;
}

export async function resolveAdminRoleCodes(adminId) {
  if (!isBillingDbConfigured()) return [];
  await ensureRbacSeed();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT r.code FROM admin_roles ar JOIN roles r ON r.id = ar.role_id WHERE ar.admin_id = $1`,
    [Number(adminId)],
  );
  return rows.map((r) => r.code);
}
