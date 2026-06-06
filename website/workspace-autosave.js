/**
 * Authenticated workspace autosave — survives page refresh for signed-in users.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'cutup_workspace_v1';
  const SCHEMA = 1;
  let saveTimer = null;
  let restoredOnce = false;

  function hasSession() {
    return !!(
      typeof global.getCutupSessionId === 'function' &&
      global.getCutupSessionId() &&
      typeof global.cutupSessionIsVerified === 'function' &&
      global.cutupSessionIsVerified()
    );
  }

  function readSourceUrl() {
    const ids = ['youtubeUrlInput', 'instagramUrlInput', 'tiktokUrlInput', 'audioUrlInput'];
    for (const id of ids) {
      const el = document.getElementById(id);
      const v = String(el?.value || '').trim();
      if (v) return v;
    }
    return global.cutupLastTranscription?.sourceUrl || '';
  }

  function readActiveTab() {
    const resultSection = document.getElementById('resultSection');
    return resultSection?.querySelector('.tab-btn.active')?.dataset?.tab || 'srt';
  }

  function collectState() {
    const last = global.cutupLastTranscription;
    if (!last) return null;
    const hasText = String(last.fullText || last.transcription || '').trim().length > 0;
    const hasSeg = Array.isArray(last.segments) && last.segments.length > 0;
    if (!hasText && !hasSeg) return null;

    const exportMount = document.getElementById('cutupViralExportMount');
    const exportQuality = exportMount?.querySelector('#cutupExportQuality')?.value || 'fast';

    return {
      schema: SCHEMA,
      savedAt: Date.now(),
      sessionId: global.getCutupSessionId?.() || null,
      lastTranscription: {
        cacheKey: last.cacheKey,
        summary: last.summary,
        fullText: last.fullText,
        transcription: last.transcription,
        segments: last.segments || [],
        title: last.title,
        platform: last.platform,
        sourceUrl: last.sourceUrl,
        lastDisplayOptions: last.lastDisplayOptions || {}
      },
      subtitleVersions: global.cutupSubtitleVersions || null,
      stylePreset:
        global.cutupActiveStylePreset ||
        global.cutupSelectedPresetId ||
        (() => {
          try {
            return localStorage.getItem('cutup_style_preset');
          } catch {
            return null;
          }
        })(),
      renderCaptionMode: global.cutupRenderCaptionMode || null,
      detectedSourceLanguage: global.cutupDetectedSourceLanguage || null,
      currentSrtContent: global.currentSrtContent || null,
      originalFullText: global.originalFullText || null,
      sourceUrl: readSourceUrl(),
      activeTab: readActiveTab(),
      exportQuality,
      exportStyleId: exportMount?.querySelector('#cutupExportStyleSelect')?.value || null,
      readyExportJobId: exportMount?.dataset?.readyJobId || null,
      srtLanguage: document.getElementById('srtLanguage')?.value || 'original'
    };
  }

  function saveNow() {
    if (!hasSession()) return;
    const state = collectState();
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }

  function scheduleSave() {
    if (!hasSession()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, 400);
  }

  function restoreSubtitleVersions(store) {
    if (!store?.versions || !global.CutupSubtitleVersions) return;
    global.cutupSubtitleVersions = JSON.parse(JSON.stringify(store));
    const orig = store.versions.original;
    if (orig) {
      global.CutupSubtitleVersions.syncGlobalsFromVersion(orig);
    }
    global.CutupSubtitleVersions.refreshVersionSelector?.();
    global.CutupSubtitleVersions.bindSelector?.();
  }

  function restoreStylePreset(presetId) {
    if (!presetId) return;
    try {
      localStorage.setItem('cutup_style_preset', presetId);
    } catch {
      /* ignore */
    }
    global.cutupActiveStylePreset = presetId;
    global.cutupSelectedPresetId = presetId;
    if (global.CutupPresetSelector?.setActivePresetId) {
      global.CutupPresetSelector.setActivePresetId(presetId, 'workspace-restore');
    }
    if (typeof global.refreshCutupSubtitleStyles === 'function') {
      global.refreshCutupSubtitleStyles();
    }
  }

  function fillSourceUrl(url, platform) {
    if (!url) return;
    const map = {
      youtube: 'youtubeUrlInput',
      instagram: 'instagramUrlInput',
      tiktok: 'tiktokUrlInput',
      audiofile: 'audioUrlInput'
    };
    const id = map[platform] || map.youtube;
    const el = document.getElementById(id);
    if (el && !String(el.value || '').trim()) {
      el.value = url;
    }
  }

  function tryRestore() {
    if (restoredOnce) return false;
    if (!hasSession()) return false;
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
    if (!raw) return false;

    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!state || state.schema !== SCHEMA || !state.lastTranscription) return false;
    if (state.sessionId && state.sessionId !== global.getCutupSessionId?.()) return false;

    const last = state.lastTranscription;
    const opts = {
      ...(last.lastDisplayOptions || {}),
      title: last.title,
      platform: last.platform,
      sourceUrl: state.sourceUrl || last.sourceUrl,
      originalLanguage: state.detectedSourceLanguage || last.lastDisplayOptions?.originalLanguage,
      activeTab: state.activeTab || 'srt',
      outputMode: last.lastDisplayOptions?.outputMode || 'unified',
      cacheReplay: true
    };

    if (state.detectedSourceLanguage) {
      global.cutupDetectedSourceLanguage = state.detectedSourceLanguage;
    }
    if (state.originalFullText) {
      global.originalFullText = state.originalFullText;
    }
    if (state.currentSrtContent) {
      global.currentSrtContent = state.currentSrtContent;
    }
    if (state.renderCaptionMode) {
      global.cutupRenderCaptionMode = state.renderCaptionMode;
    }

    fillSourceUrl(state.sourceUrl || last.sourceUrl, last.platform);

    if (typeof global.displayResults === 'function') {
      global.displayResults(last.summary, last.fullText || last.transcription, last.segments || [], opts);
    }

    restoreSubtitleVersions(state.subtitleVersions);
    restoreStylePreset(state.stylePreset);

    const srtLang = document.getElementById('srtLanguage');
    if (srtLang && state.srtLanguage) {
      srtLang.value = state.srtLanguage;
    }

    const exportMount = document.getElementById('cutupViralExportMount');
    if (exportMount && state.exportQuality) {
      const q = exportMount.querySelector('#cutupExportQuality');
      if (q) q.value = state.exportQuality;
    }
    if (exportMount && state.exportStyleId) {
      const styleSel = exportMount.querySelector('#cutupExportStyleSelect');
      if (styleSel) styleSel.value = state.exportStyleId;
    }
    if (exportMount && state.readyExportJobId) {
      exportMount.dataset.readyJobId = state.readyExportJobId;
      if (global.CutupViralExport?.restoreReadyExport) {
        global.CutupViralExport.restoreReadyExport(exportMount, state.readyExportJobId);
      }
    }

    if (typeof global.syncSrtRawPanel === 'function') {
      global.syncSrtRawPanel();
    }
    if (global.CutupViralExport?.refreshExportButton) {
      global.CutupViralExport.refreshExportButton();
    }

    restoredOnce = true;
    return true;
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  global.addEventListener?.('cutup:preset-changed', () => scheduleSave());
  global.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  global.addEventListener?.('pagehide', saveNow);

  global.CutupWorkspaceAutosave = {
    scheduleSave,
    saveNow,
    tryRestore,
    clear
  };
})(typeof window !== 'undefined' ? window : globalThis);
