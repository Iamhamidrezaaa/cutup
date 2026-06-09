/**
 * Feature flag: ENABLE_RTL_LANGUAGES
 * UI-only gate for Persian, Arabic, Urdu and Hebrew selectors/marketing.
 * Backend translation, ASS, fonts and detection stay fully enabled.
 */

export const RTL_UI_LANGUAGE_CODES = Object.freeze(['fa', 'ar', 'ur', 'he']);

export function parseEnableRtlLanguagesEnv(raw = process.env.ENABLE_RTL_LANGUAGES) {
  if (raw == null || raw === '') return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isRtlLanguagesEnabled() {
  return parseEnableRtlLanguagesEnv();
}

export function isRtlUiLanguageCode(code) {
  const n = String(code || '').trim().toLowerCase().slice(0, 2);
  return RTL_UI_LANGUAGE_CODES.includes(n);
}

export function filterRtlUiLanguageCodes(codes) {
  if (isRtlLanguagesEnabled()) return codes;
  return (codes || []).filter((code) => !isRtlUiLanguageCode(code));
}
