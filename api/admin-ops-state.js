/**
 * Authenticated read-only proxy for Instalogist operational-state.json.
 * Configure INSTALOGIST_OPERATIONAL_STATE_URL (HTTPS) and/or INSTALOGIST_OPERATIONAL_STATE_PATH (absolute or cwd-relative).
 *
 * Roles: super_admin and admin only (editor forbidden). Maps to owner/ops access; audit-style visibility aligns with Audit Log tab.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveAdminAuth } from './admin-panel-auth.js';

const CONTRACT_ID = 'instalogist-operational-state-1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function canAccessOps(auth) {
  if (!auth) return false;
  const r = String(auth.role || '').toLowerCase();
  return r === 'super_admin' || r === 'admin';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = await resolveAdminAuth(req);
  if (!canAccessOps(auth)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Operations dashboard requires admin or super_admin role.'
    });
  }

  const fetchedAt = new Date().toISOString();
  let state = null;
  let source = 'none';

  const remoteUrl = String(process.env.INSTALOGIST_OPERATIONAL_STATE_URL || '').trim();
  const filePath = String(process.env.INSTALOGIST_OPERATIONAL_STATE_PATH || '').trim();

  try {
    if (remoteUrl) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(remoteUrl, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (!r.ok) {
        return res.status(502).json({
          error: 'upstream_error',
          status: r.status,
          message: 'Failed to fetch INSTALOGIST_OPERATIONAL_STATE_URL'
        });
      }
      const text = await r.text();
      state = JSON.parse(text);
      source = 'url';
    } else if (filePath) {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      const text = await readFile(resolved, 'utf8');
      state = JSON.parse(text);
      source = 'file';
    } else if (process.env.NODE_ENV !== 'production') {
      const example = path.join(__dirname, '..', 'instalogist', 'parser', 'example', 'operational-state.example.json');
      const text = await readFile(example, 'utf8');
      state = JSON.parse(text);
      source = 'repo_example_dev_fallback';
    } else {
      return res.status(503).json({
        error: 'ops_state_not_configured',
        message: 'Set INSTALOGIST_OPERATIONAL_STATE_URL or INSTALOGIST_OPERATIONAL_STATE_PATH',
        hint: 'Point to your CI artifact or internal URL for operational-state.json'
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: 'load_failed', message: msg });
  }

  const contractValid = state != null && typeof state === 'object' && state.contract_id === CONTRACT_ID;
  const genAt = state && typeof state.generated_at === 'string' ? state.generated_at : null;
  let snapshotAgeSec = null;
  if (genAt) {
    const t = Date.parse(genAt);
    if (!Number.isNaN(t)) snapshotAgeSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    fetched_at: fetchedAt,
    source,
    contract_id: state?.contract_id ?? null,
    contract_valid: contractValid,
    snapshot_status: state?.snapshot_status ?? null,
    parser_version: state?.parser_version ?? null,
    generated_at: genAt,
    snapshot_age_sec: snapshotAgeSec,
    state
  });
}
