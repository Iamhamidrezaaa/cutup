/**
 * In-memory subtitle language versions (original + translations).
 */
(function (global) {
  'use strict';

  function cloneSegments(segments) {
    return (segments || []).map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text || '').trim()
    }));
  }

  function normKey(code) {
    const c = String(code || '').toLowerCase().trim();
    if (!c || c === 'original' || c === 'auto' || c === 'und') return 'original';
    return c.length >= 2 ? c.slice(0, 2) : c;
  }

  function versionLabel(key, isOriginal, languageCode) {
    if (isOriginal) {
      const name =
        typeof global.getLanguageName === 'function'
          ? global.getLanguageName(languageCode)
          : languageCode;
      const code = normKey(languageCode);
      if (code && code !== 'original') {
        return `${code.toUpperCase()} (${name})`;
      }
      return `${name} (Original)`;
    }
    const name =
      typeof global.getLanguageName === 'function' ? global.getLanguageName(key) : key;
    return `${name} Translation`;
  }

  function ensureStore() {
    if (!global.cutupSubtitleVersions) {
      global.cutupSubtitleVersions = { activeKey: 'original', versions: {} };
    }
    return global.cutupSubtitleVersions;
  }

  function getActiveVersion() {
    const store = ensureStore();
    return store.versions[store.activeKey] || store.versions.original || null;
  }

  function syncGlobalsFromVersion(v) {
    if (!v) return;
    global.cutupSourceSegments = cloneSegments(v.segments);
    global.currentSrtContent = v.srtContent;
    if (v.isOriginal) {
      global.originalSrtContent = v.srtContent;
      global.originalSrtSegments = cloneSegments(v.segments);
    }
    if (global.cutupLastTranscription) {
      global.cutupLastTranscription.segments = cloneSegments(v.segments);
    }
    global.cutupDetectedSourceLanguage = v.language || global.cutupDetectedSourceLanguage;
  }

  function refreshVersionSelector() {
    const bar = document.getElementById('cutupSubtitleVersionBar');
    const sel = document.getElementById('cutupSubtitleVersionSelect');
    if (!sel) return;

    const store = ensureStore();
    const keys = Object.keys(store.versions);
    if (!keys.length) {
      if (bar) bar.hidden = true;
      return;
    }
    if (bar) bar.hidden = false;

    const prev = sel.value;
    sel.innerHTML = '';
    const ordered = keys.includes('original')
      ? ['original', ...keys.filter((k) => k !== 'original').sort()]
      : keys.sort();

    for (const key of ordered) {
      const v = store.versions[key];
      if (!v) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = v.label || key;
      sel.appendChild(opt);
    }

    const next = store.versions[store.activeKey] ? store.activeKey : ordered[0];
    sel.value = store.versions[prev] ? prev : next;
    if (sel.value !== store.activeKey) {
      store.activeKey = sel.value;
      syncGlobalsFromVersion(getActiveVersion());
    }
  }

  function setActiveVersion(key) {
    const store = ensureStore();
    if (!store.versions[key]) return false;
    store.activeKey = key;
    syncGlobalsFromVersion(store.versions[key]);
    refreshVersionSelector();
    return true;
  }

  function registerOriginal({ segments, srtContent, language }) {
    global.CutupWhisperTimingTrace?.recordWhisperTimingStage?.('after_register_original', segments, {
      note: 'before cloneSegments (words preserved in snapshot)'
    });
    const store = ensureStore();
    const lang = normKey(language) === 'original' ? normKey(global.cutupDetectedSourceLanguage) : normKey(language);
    const segs = cloneSegments(segments);
    const srt = String(srtContent || '').trim();

    store.versions.original = {
      key: 'original',
      language: lang || 'en',
      label: versionLabel('original', true, lang || 'en'),
      segments: segs,
      srtContent: srt,
      sourceLanguage: lang || 'en',
      translatedAt: null,
      isOriginal: true
    };
    store.activeKey = 'original';
    syncGlobalsFromVersion(store.versions.original);
    refreshVersionSelector();
  }

  function registerTranslation(targetLanguage, { srtContent, segments }) {
    global.CutupWhisperTimingTrace?.recordWhisperTimingStage?.('after_register_translation', segments, {
      targetLanguage: normKey(targetLanguage)
    });
    const store = ensureStore();
    const key = normKey(targetLanguage);
    if (key === 'original') return null;

    let segs = cloneSegments(segments);
    const srt = String(srtContent || '').trim();
    if (!segs.length && srt && typeof global.parseSRTToSegments === 'function') {
      segs = cloneSegments(global.parseSRTToSegments(srt));
    }

    store.versions[key] = {
      key,
      language: key,
      label: versionLabel(key, false, key),
      segments: segs,
      srtContent: srt,
      sourceLanguage: store.versions.original?.language || 'en',
      translatedAt: Date.now(),
      isOriginal: false
    };
    store.activeKey = key;
    syncGlobalsFromVersion(store.versions[key]);
    refreshVersionSelector();
    return key;
  }

  function getActiveSegments() {
    const v = getActiveVersion();
    return v ? cloneSegments(v.segments) : [];
  }

  function getActiveSrtContent() {
    const v = getActiveVersion();
    return v?.srtContent || '';
  }

  function reset() {
    global.cutupSubtitleVersions = { activeKey: 'original', versions: {} };
    refreshVersionSelector();
  }

  function bindSelector() {
    const sel = document.getElementById('cutupSubtitleVersionSelect');
    if (!sel || sel.dataset.cutupBound === '1') return;
    sel.dataset.cutupBound = '1';
    sel.addEventListener('change', () => {
      if (setActiveVersion(sel.value)) {
        if (typeof global.syncSrtRawPanel === 'function') global.syncSrtRawPanel();
        if (typeof global.refreshCutupSubtitleStyles === 'function') {
          global.refreshCutupSubtitleStyles();
        }
        if (global.CutupViralExport?.refreshExportButton) {
          global.CutupViralExport.refreshExportButton();
        }
      }
    });
  }

  global.CutupSubtitleVersions = {
    ensureStore,
    getActiveVersion,
    getActiveSegments,
    getActiveSrtContent,
    registerOriginal,
    registerTranslation,
    setActiveVersion,
    refreshVersionSelector,
    syncGlobalsFromVersion,
    reset,
    bindSelector,
    versionLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
