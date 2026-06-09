/**
 * Client mirror of ENABLE_RTL_LANGUAGES (api/rtl-languages-feature.js).
 * Gates user-facing language selectors and RTL marketing only.
 */
(function (global) {
  'use strict';

  var RTL_UI_LANGUAGE_CODES = ['fa', 'ar', 'ur', 'he'];
  var readyPromise = null;
  var configured = typeof global.CUTUP_ENABLE_RTL_LANGUAGES === 'boolean';

  function normalizeCode(code) {
    return String(code || '').trim().toLowerCase().slice(0, 2);
  }

  function isRtlLanguagesEnabled() {
    if (typeof global.CUTUP_ENABLE_RTL_LANGUAGES === 'boolean') {
      return global.CUTUP_ENABLE_RTL_LANGUAGES;
    }
    return false;
  }

  function isRtlUiLanguageCode(code) {
    return RTL_UI_LANGUAGE_CODES.indexOf(normalizeCode(code)) >= 0;
  }

  function filterTranslationOptions(options) {
    if (isRtlLanguagesEnabled()) return options || [];
    return (options || []).filter(function (lang) {
      return !isRtlUiLanguageCode(lang && lang.code);
    });
  }

  function filterLanguageCode(code) {
    if (!code || code === 'original') return code;
    return isRtlLanguagesEnabled() || !isRtlUiLanguageCode(code) ? code : null;
  }

  function getPresetShowcaseMockLines() {
    if (isRtlLanguagesEnabled()) {
      return { lineA: 'هوک', lineB: 'شما' };
    }
    return { lineA: 'YOUR', lineB: 'HOOK' };
  }

  function applyMarketingVisibility() {
    var enabled = isRtlLanguagesEnabled();
    document.querySelectorAll('[data-cutup-rtl-marketing]').forEach(function (el) {
      if (enabled) {
        el.hidden = false;
        el.removeAttribute('aria-hidden');
      } else {
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function stripRtlOptionsFromSelect(select) {
    if (!select || isRtlLanguagesEnabled()) return;
    Array.from(select.options || []).forEach(function (opt) {
      if (isRtlUiLanguageCode(opt.value)) opt.remove();
    });
    if (isRtlUiLanguageCode(select.value)) select.value = 'original';
  }

  function stripRtlOptionsFromDocument() {
    if (isRtlLanguagesEnabled()) return;
    document.querySelectorAll('select.srt-language-select, select[id$="Language"], select[id$="LanguageSelect"]').forEach(stripRtlOptionsFromSelect);
  }

  function apiBase() {
    if (typeof global.CUTUP_API_BASE === 'string' && global.CUTUP_API_BASE) return global.CUTUP_API_BASE;
    return '';
  }

  function ensureReady() {
    if (configured) return Promise.resolve(isRtlLanguagesEnabled());
    if (readyPromise) return readyPromise;
    readyPromise = fetch(apiBase() + '/api/public-config', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('public-config ' + res.status);
        return res.json();
      })
      .then(function (data) {
        global.CUTUP_ENABLE_RTL_LANGUAGES = Boolean(data && data.enableRtlLanguages);
        configured = true;
        return global.CUTUP_ENABLE_RTL_LANGUAGES;
      })
      .catch(function () {
        global.CUTUP_ENABLE_RTL_LANGUAGES = false;
        configured = true;
        return false;
      });
    return readyPromise;
  }

  global.CutupRtlLanguages = {
    RTL_UI_LANGUAGE_CODES: RTL_UI_LANGUAGE_CODES.slice(),
    isRtlLanguagesEnabled: isRtlLanguagesEnabled,
    isRtlUiLanguageCode: isRtlUiLanguageCode,
    filterTranslationOptions: filterTranslationOptions,
    filterLanguageCode: filterLanguageCode,
    getPresetShowcaseMockLines: getPresetShowcaseMockLines,
    applyMarketingVisibility: applyMarketingVisibility,
    stripRtlOptionsFromDocument: stripRtlOptionsFromDocument,
    ensureReady: ensureReady
  };
})(typeof window !== 'undefined' ? window : globalThis);
