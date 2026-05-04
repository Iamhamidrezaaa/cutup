/** In-memory IP → ISO country (2 letters), short TTL. */
const cache = new Map();
const TTL_MS = 60 * 60 * 1000;

export async function resolveCountryFromIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw || raw === '127.0.0.1' || raw.startsWith('::')) return null;

  const now = Date.now();
  const hit = cache.get(raw);
  if (hit && now - hit.t < TTL_MS) return hit.code;

  let code = null;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(raw)}/country/`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'cutup-audit/1.0' }
    });
    clearTimeout(tid);
    if (r.ok) {
      const t = (await r.text()).trim().toUpperCase().slice(0, 2);
      if (t && /^[A-Z]{2}$/.test(t)) code = t;
    }
  } catch {
    code = null;
  }

  cache.set(raw, { code, t: now });
  return code;
}
