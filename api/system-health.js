import { accessSync, constants } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureOffersSchema, getOffersSchemaIntrospection, getOffersSchemaStatus } from './offers-bootstrap.js';
import { checkFfmpegHealth, checkYtDlpHealth } from './media-tool-health.js';

const execFileAsync = promisify(execFile);

async function checkCommand(name, args = ['--version']) {
  try {
    const { stdout, stderr } = await execFileAsync(name, args, { timeout: 5000 });
    return { ok: true, command: name, output: String(stdout || stderr || '').slice(0, 140) };
  } catch (e) {
    return { ok: false, command: name, error: e?.message || String(e) };
  }
}

async function checkDb() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'DATABASE_URL missing' };
  try {
    const r = await getPool().query('SELECT NOW() as now');
    return { ok: true, now: r.rows?.[0]?.now || null };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

function checkTmpWritable() {
  try {
    const dir = tmpdir();
    accessSync(dir, constants.W_OK);
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const db = await checkDb();
  const offersEnsure = db.ok ? await ensureOffersSchema() : { ok: false, reason: 'db_unavailable' };
  const offersStatus = getOffersSchemaStatus();
  const offersSchemaIntrospection = db.ok ? await getOffersSchemaIntrospection() : { ok: false, reason: 'db_unavailable' };
  const ytTelemetry = await checkYtDlpHealth();
  const ffmpegTelemetry = await checkFfmpegHealth();
  const ytDlp = {
    ok: ytTelemetry.status === 'operational',
    ...ytTelemetry
  };
  const ffmpeg = {
    ok: ffmpegTelemetry.status === 'operational',
    ...ffmpegTelemetry
  };
  const tmp = checkTmpWritable();

  const checks = {
    db,
    offersSchema: { ...offersEnsure, ready: offersStatus.ready, lastError: offersStatus.lastError },
    offersSchemaIntrospection,
    ytDlp,
    ffmpeg,
    tempDir: tmp
  };
  const ok = db.ok && offersEnsure.ok && ytDlp.ok && ffmpeg.ok && tmp.ok;
  const status = ok ? 200 : 503;
  return res.status(status).json({
    ok,
    degraded: !ok,
    timestamp: new Date().toISOString(),
    checks
  });
}

