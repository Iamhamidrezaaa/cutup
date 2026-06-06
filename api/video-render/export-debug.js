/** Master switch: production export skips diagnostics when unset/false. */
export function isDebugExportEnabled() {
  const v = String(process.env.DEBUG_EXPORT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
