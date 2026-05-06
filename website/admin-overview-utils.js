/** Formatting helpers for admin overview dashboard */
window.CutupDashFmt = {
  eur(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `€${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  },
  num(n, digits = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits > 0 ? Math.min(2, digits) : 0
    });
  },
  pct(n) {
    if (n == null || Number.isNaN(Number(n))) return null;
    const v = Number(n);
    const sign = v > 0 ? '+' : '';
    return `${sign}${v}%`;
  },
  bytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
    return `${(v / 1073741824).toFixed(2)} GB`;
  },
  date(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  },
  trendHtml(pct) {
    if (pct == null || Number.isNaN(Number(pct))) return '';
    const v = Number(pct);
    const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
    return `<span class="dash-trend ${cls}">${arrow} ${Math.abs(v)}%</span>`;
  },
  planLabel(plan) {
    const p = String(plan || 'free');
    return p.charAt(0).toUpperCase() + p.slice(1);
  }
};
