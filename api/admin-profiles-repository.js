import { getPool } from './db/pool.js';
import { ensureAdminProfilesSchema } from './admin-profiles-bootstrap.js';

function mapProfile(row) {
  if (!row) return null;
  return {
    admin_user_id: Number(row.admin_user_id),
    display_name: row.display_name,
    avatar_url: row.avatar_url || null,
    job_title: row.job_title || null,
    is_visible: row.is_visible !== false,
  };
}

function defaultDisplayNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || 'Support Agent';
  const cleaned = local.replace(/[._+-]+/g, ' ').trim();
  if (!cleaned) return 'Support Agent';
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function avatarFallbackUrl(seed, size = 96) {
  const s = encodeURIComponent(String(seed || 'Support').trim() || 'Support');
  return `https://api.dicebear.com/7.x/initials/svg?seed=${s}&backgroundColor=635bff,e0e7ff,f5f3ff&fontSize=42`;
}

export async function ensureAdminProfileSeed(adminId, email) {
  await ensureAdminProfilesSchema();
  const pool = getPool();
  const existing = await pool.query(
    `SELECT admin_user_id FROM admin_profiles WHERE admin_user_id = $1 LIMIT 1`,
    [Number(adminId)],
  );
  if (existing.rows[0]) return mapProfile(existing.rows[0]);

  const displayName = defaultDisplayNameFromEmail(email);
  const { rows } = await pool.query(
    `INSERT INTO admin_profiles (admin_user_id, display_name, job_title, is_visible)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (admin_user_id) DO NOTHING
     RETURNING *`,
    [Number(adminId), displayName, 'Customer Success'],
  );
  if (rows[0]) return mapProfile(rows[0]);
  const again = await pool.query(`SELECT * FROM admin_profiles WHERE admin_user_id = $1`, [Number(adminId)]);
  return mapProfile(again.rows[0]);
}

export async function getAdminProfile(adminId) {
  await ensureAdminProfilesSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM admin_profiles WHERE admin_user_id = $1 LIMIT 1`,
    [Number(adminId)],
  );
  return mapProfile(rows[0]);
}

export async function getAdminProfilesMap(adminIds = []) {
  await ensureAdminProfilesSchema();
  const ids = [...new Set(adminIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return {};
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM admin_profiles WHERE admin_user_id = ANY($1::int[])`,
    [ids],
  );
  const map = {};
  rows.forEach((row) => {
    map[Number(row.admin_user_id)] = mapProfile(row);
  });
  return map;
}

export async function resolveAgentIdentity(adminId, adminEmail) {
  let profile = await getAdminProfile(adminId);
  if (!profile && adminEmail) {
    profile = await ensureAdminProfileSeed(adminId, adminEmail);
  }
  const displayName = profile?.display_name || defaultDisplayNameFromEmail(adminEmail);
  return {
    display_name: displayName,
    avatar_url: profile?.avatar_url || avatarFallbackUrl(displayName),
    job_title: profile?.job_title || 'Customer Success',
    is_visible: profile?.is_visible !== false,
  };
}

export async function upsertAdminProfile(adminId, input = {}) {
  await ensureAdminProfilesSchema();
  const id = Number(adminId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'invalid_admin' };

  const displayName = String(input.displayName || input.display_name || '').trim();
  if (!displayName || displayName.length < 2) return { ok: false, reason: 'invalid_display_name' };

  const avatarUrl = String(input.avatarUrl || input.avatar_url || '').trim() || null;
  const jobTitle = String(input.jobTitle || input.job_title || '').trim() || 'Customer Success';

  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO admin_profiles (admin_user_id, display_name, avatar_url, job_title, is_visible, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, NOW())
     ON CONFLICT (admin_user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       job_title = EXCLUDED.job_title,
       updated_at = NOW()
     RETURNING *`,
    [id, displayName, avatarUrl, jobTitle],
  );
  const profile = mapProfile(rows[0]);
  return {
    ok: true,
    profile: {
      ...profile,
      avatar_url: profile.avatar_url || avatarFallbackUrl(profile.display_name),
    },
  };
}

export async function listAdminsWithProfiles() {
  await ensureAdminProfilesSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.id, a.email, a.role,
            p.display_name, p.avatar_url, p.job_title, p.is_visible
     FROM admins a
     LEFT JOIN admin_profiles p ON p.admin_user_id = a.id
     WHERE a.status = 'active'
     ORDER BY COALESCE(p.display_name, a.email) ASC`,
  );

  const result = [];
  for (const row of rows) {
    let profile = mapProfile({
      admin_user_id: row.id,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      job_title: row.job_title,
      is_visible: row.is_visible,
    });
    if (!profile) {
      profile = await ensureAdminProfileSeed(row.id, row.email);
    }
    result.push({
      id: Number(row.id),
      email: row.email,
      role: row.role,
      profile: {
        display_name: profile.display_name,
        avatar_url: profile.avatar_url || avatarFallbackUrl(profile.display_name),
        job_title: profile.job_title || 'Customer Success',
        is_visible: profile.is_visible !== false,
      },
    });
  }
  return result;
}
