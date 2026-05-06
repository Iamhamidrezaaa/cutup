export function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`invalid_${field}`);
  return v.trim();
}

export function optionalString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

export function optionalStringArray(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}
