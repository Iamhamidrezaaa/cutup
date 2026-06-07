/**
 * 1-click viral subtitle MP4 export (ASS + FFmpeg backend).
 */
(function (global) {
  'use strict';

  const STALL_MS = 420000;
  const HQ_NOTICE_MS = 90000;
  const HQ_SUGGEST_FAST_MS = 150000;
  const HISTORY_KEY = 'cutup_export_history_v1';
  const STAGE_LABELS = {
    queued: 'Queued',
    preparing: 'Preparing',
    preparing_source: 'Preparing',
    subtitle_layout: 'Optimizing captions',
    rendering: 'Encoding TikTok-ready MP4',
    muxing: 'Muxing',
    finalizing: 'Finalizing',
    generating_captions: 'Optimizing captions',
    generating_subtitles: 'Generating captions',
    rendering_video: 'Encoding TikTok-ready MP4',
    finalizing_export: 'Finalizing',
    exporting: 'Finalizing export',
    ready_to_download: 'Ready to download',
    completed: 'Ready to download',
    failed: 'Failed',
    cancelled: 'Cancelled'
  };
  const STYLE_OPTIONS = Object.freeze({
    'clean-srt': { label: 'Clean SRT', presetId: 'clean-srt', captionMode: 'accurate', styleMode: 'safe' },
    hormozi: { label: 'Alex Hormozi', presetId: 'hormozi', captionMode: 'viral', styleMode: 'cinematic' },
    mrbeast: { label: 'MrBeast', presetId: 'mrbeast', captionMode: 'viral', styleMode: 'cinematic' },
    'ali-abdaal': { label: 'Ali Abdaal Clean', presetId: 'ali-abdaal', captionMode: 'viral', styleMode: 'safe' },
    'tiktok-neon': { label: 'TikTok Neon', presetId: 'tiktok-neon', captionMode: 'viral', styleMode: 'cinematic' },
    'luxury-minimal': { label: 'Luxury Minimal', presetId: 'luxury-minimal', captionMode: 'viral', styleMode: 'cinematic' },
    podcast: { label: 'Podcast', presetId: 'podcast', captionMode: 'viral', styleMode: 'safe' }
  });

  let exportEventSource = null;
  let stallWatchTimer = null;
  let lastServerEventAt = 0;
  let activeJobId = null;
  let exportStartedAt = 0;
  let lastProgressAt = 0;
  let lastProgressVal = 0;
  let completedHandled = false;
  let exportHistory = [];

  function getSessionId() {
    if (typeof global.getCutupSessionId === 'function') return global.getCutupSessionId();
    return global.localStorage?.getItem('cutup_session') || null;
  }

  function getActivePresetId() {
    return (
      global.cutupActiveStylePreset ||
      global.CutupPresetSelector?.getActivePresetId?.() ||
      global.CutupStylePresets?.DEFAULT_PRESET_ID ||
      'hormozi'
    );
  }

  function getSelectedPresetId() {
    return String(global.cutupSelectedPresetId || getActivePresetId() || 'hormozi');
  }

  function setSelectedPresetId(presetId) {
    global.cutupSelectedPresetId = String(presetId || '').trim() || 'hormozi';
  }

  function syncPresetCards(presetId) {
    const mount = document.getElementById('cutupStylePresetsMount');
    if (!mount) return;
    const visualPresetId = presetId === 'clean-srt' ? 'ali-abdaal' : presetId;
    mount.querySelectorAll('.cutup-preset-card').forEach((card) => {
      const on = card.getAttribute('data-preset-id') === visualPresetId;
      card.classList.toggle('cutup-preset-card--active', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function getSourceTruthSegments() {
    if (global.CutupSubtitleVersions?.getActiveSegments) {
      const active = global.CutupSubtitleVersions.getActiveSegments();
      if (active.length) return active;
    }
    if (Array.isArray(global.cutupSourceSegments) && global.cutupSourceSegments.length) {
      return global.cutupSourceSegments.map((s) => ({
        start: s.start,
        end: s.end,
        text: String(s.text || '')
      }));
    }
    const cached = global.cutupLastTranscription?.segments;
    if (Array.isArray(cached) && cached.length) {
      return cached.map((s) => ({
        start: s.start,
        end: s.end,
        text: String(s.text || '')
      }));
    }
    return [];
  }

  function getSelectedVersionKey() {
    return (
      global.CutupSubtitleVersions?.getActiveVersion?.()?.key ||
      global.cutupSubtitleVersions?.activeKey ||
      'original'
    );
  }

  function normalizeStyleOptionId(raw, { strict = false } = {}) {
    const id = String(raw || '').trim().toLowerCase();
    if (STYLE_OPTIONS[id]) return id;
    if (strict) {
      const err = new Error(`PRESET_NOT_APPLIED: ${id || 'missing_preset_id'}`);
      err.code = 'PRESET_NOT_APPLIED';
      throw err;
    }
    return 'hormozi';
  }

  function styleOptionFromPresetId(presetId) {
    const id = String(presetId || '').trim().toLowerCase();
    if (!id) return 'hormozi';
    if (STYLE_OPTIONS[id]) return id;
    if (id === 'clean' || id === 'cleansrt' || id === 'clean-srt') return 'clean-srt';
    if (id === 'alexhormozi' || id === 'alex-hormozi') return 'hormozi';
    if (id === 'mrbeast' || id === 'mr-beast') return 'mrbeast';
    if (id === 'aliabdaal') return 'ali-abdaal';
    if (id === 'tiktokneon') return 'tiktok-neon';
    if (id === 'luxuryminimal') return 'luxury-minimal';
    return 'hormozi';
  }

  function getExportStyleSelection(container) {
    const select = container.querySelector('#cutupExportStyleSelect');
    const selectedId = normalizeStyleOptionId(select?.value || styleOptionFromPresetId(getSelectedPresetId()), {
      strict: true
    });
    const option = STYLE_OPTIONS[selectedId] || STYLE_OPTIONS.hormozi;
    const quality = container.querySelector('#cutupExportQuality')?.value || 'fast';
    return {
      selectedId,
      selectedPresetId: selectedId,
      presetId: option.presetId,
      captionMode: option.captionMode,
      styleMode: option.styleMode,
      renderQuality: quality
    };
  }

  function syncStyleSelectFromPreset(container, presetId) {
    const styleId = styleOptionFromPresetId(presetId);
    const select = container?.querySelector('#cutupExportStyleSelect');
    if (select) select.value = styleId;
    setSelectedPresetId(styleId);
  }

  function applyStyleSelectionToPreset(styleSelection) {
    setSelectedPresetId(styleSelection.selectedPresetId || styleSelection.selectedId);
    global.cutupActiveStylePreset = styleSelection.presetId;
    global.cutupRenderCaptionMode = styleSelection.captionMode;
    if (global.CutupPresetSelector?.setActivePresetId) {
      global.CutupPresetSelector.setActivePresetId(styleSelection.presetId, 'export-style-select');
    }
    syncPresetCards(styleSelection.presetId);
    global.CutupSubtitleStyles?.refreshPreview?.();
  }

  /**
   * Export burn source: clean SRT the site generates (same as "View clean SRT" / download).
   */
  function getCleanSrtSegmentsForExport() {
    if (typeof global.buildCleanSrtFromSource !== 'function' || typeof global.parseSRTToSegments !== 'function') {
      return { segments: [], source: 'none' };
    }
    const cleanSrt = global.buildCleanSrtFromSource();
    if (!cleanSrt) return { segments: [], source: 'empty' };
    const parsed = global.parseSRTToSegments(cleanSrt);
    if (!parsed.length) return { segments: [], source: 'parse_failed' };
    const stripTags = (text) =>
      String(text || '')
        .replace(/\[(?:music|applause|laughter|inaudible|crowd cheering)\]\s*/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return {
      segments: parsed.map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
        text: stripTags(s.text)
      })),
      source: 'clean-srt'
    };
  }

  function buildFreshExportDocument(presetId) {
    const { segments } = getCleanSrtSegmentsForExport();
    if (!segments.length || !global.CutupStyleExport?.buildExportDocument) return null;
    return global.CutupStyleExport.buildExportDocument(segments, presetId);
  }

  function segmentsFromExportDoc(doc) {
    if (!doc || doc.format !== 'cutup-style-v1' || !Array.isArray(doc.cues)) return [];
    return doc.cues.map((c) => ({
      start: Number(c.start),
      end: Number(c.end),
      text: String(c.text || (Array.isArray(c.lines) ? c.lines.join(' ') : '')).trim()
    }));
  }

  function getExportPayload() {
    const presetId = getSelectedPresetId();
    const { segments, source } = getCleanSrtSegmentsForExport();
    if (!segments.length) return null;

    const exportDoc = buildFreshExportDocument(presetId);
    if (exportDoc?.format === 'cutup-style-v1' && exportDoc.cues?.length) {
      global.cutupStyleExportDoc = exportDoc;
      const ordered = [...exportDoc.cues].sort((a, b) => Number(a.start) - Number(b.start));
      const payload = {
        exportDoc,
        segments: segmentsFromExportDoc(exportDoc),
        presetId,
        exportMeta: {
          segmentSource: source,
          videoId: global.cutupLastTranscription?.videoId || null,
          activeVersion: getSelectedVersionKey(),
          cueCount: exportDoc.cues.length,
          firstCueText: String(ordered[0]?.text || '').slice(0, 80),
          firstCueStart: Number(ordered[0]?.start)
        }
      };
      return payload;
    }
    return { segments, presetId, exportMeta: { segmentSource: source } };
  }

  function resolveSourceUrl() {
    const last = global.cutupLastTranscription || {};
    const url = last.sourceUrl || (typeof global.getCurrentUrl === 'function' ? global.getCurrentUrl() : '');
    if (!url || String(url).startsWith('upload://')) return null;
    return url;
  }

  function canExport() {
    const sub = global.userSubscription || {};
    const perms = sub.permissions || {};
    const canMp4 = perms.canExportMp4 === true || sub.features?.mp4Export === true;
    if (!canMp4) {
      const msg = global.CutupPlanPermissions?.getUpgradeMessage
        ? global.CutupPlanPermissions.getUpgradeMessage('canExportMp4')
        : 'MP4 export is available on Pro and Business plans.';
      return { ok: false, reason: msg };
    }
    const payload = getExportPayload();
    if (!payload) return { ok: false, reason: 'Transcribe a video first.' };
    const hasUrl = !!resolveSourceUrl();
    const hasFile = global.cutupLastSourceVideoFile instanceof File;
    if (!hasUrl && !hasFile) {
      return { ok: false, reason: 'Paste a social link or upload a video file to enable MP4 export.' };
    }
    return { ok: true, payload, hasUrl, hasFile };
  }

  function buildExportUrl(action, jobId, sessionId) {
    return `/api/export-video?action=${encodeURIComponent(action)}&jobId=${encodeURIComponent(jobId)}&session=${encodeURIComponent(sessionId)}`;
  }

  function isExportReady(data) {
    return (
      data.stage === 'ready_to_download' ||
      data.stage === 'completed' ||
      data.outputReady === true
    );
  }

  function formatDuration(sec) {
    const s = Math.round(Number(sec) || 0);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  function mount(container) {
    if (!container) return;
    container.innerHTML = `
      <section class="cutup-viral-export" aria-label="Viral video export">
        <div class="cutup-viral-export__head">
          <div>
            <h4 class="cutup-viral-export__title">Export viral MP4</h4>
            <p class="cutup-viral-export__sub">Burned cinematic captions · styled typography · social-ready.</p>
          </div>
          <div class="cutup-viral-export__actions">
            <select class="cutup-viral-export__quality" id="cutupExportStyleSelect" aria-label="Subtitle style" title="Subtitle style for MP4 export">
              <option value="clean-srt">Clean SRT</option>
              <option value="hormozi">Alex Hormozi</option>
              <option value="mrbeast">MrBeast</option>
              <option value="ali-abdaal">Ali Abdaal Clean</option>
              <option value="tiktok-neon">TikTok Neon</option>
              <option value="luxury-minimal">Luxury Minimal</option>
              <option value="podcast">Podcast</option>
            </select>
            <select class="cutup-viral-export__quality" id="cutupExportQuality" aria-label="Render quality">
              <option value="fast">Fast preview</option>
              <option value="hq">High quality</option>
            </select>
            <button type="button" class="cutup-viral-export__btn" id="cutupExportMp4Btn">Export MP4</button>
          </div>
        </div>
        <div class="cutup-export-queue-panel" id="cutupExportQueuePanel" hidden aria-live="polite">
          <p class="cutup-export-queue-panel__headline" id="cutupExportQueueHeadline"></p>
          <dl class="cutup-export-queue-panel__stats">
            <div><dt>Position</dt><dd id="cutupExportQueuePosition">—</dd></div>
            <div><dt>Jobs ahead</dt><dd id="cutupExportQueueAhead">—</dd></div>
            <div><dt>Est. wait</dt><dd id="cutupExportQueueWait">—</dd></div>
            <div><dt>Est. done</dt><dd id="cutupExportQueueDone">—</dd></div>
          </dl>
        </div>
        <ol class="cutup-export-pipeline" id="cutupExportPipeline" aria-label="Export stages"></ol>
        <div class="cutup-viral-export__progress" id="cutupExportProgress" aria-live="polite">
          <div class="cutup-viral-export__stage">
            <span id="cutupExportStageLabel">Starting…</span>
            <span id="cutupExportPct">0%</span>
          </div>
          <div class="cutup-viral-export__bar"><div class="cutup-viral-export__fill" id="cutupExportFill"></div></div>
          <p class="cutup-viral-export__eta" id="cutupExportEta" hidden></p>
          <p class="cutup-viral-export__eta" id="cutupExportNotice" hidden></p>
        </div>
        <div class="cutup-export-history" id="cutupExportHistory" hidden>
          <h5 class="cutup-export-history__title">Export history</h5>
          <ul class="cutup-export-history__list" id="cutupExportHistoryList"></ul>
        </div>
        <p class="cutup-viral-export__error" id="cutupExportError" hidden role="alert"></p>
        <div class="cutup-viral-export__ready" id="cutupExportReady" hidden>
          <div class="cutup-viral-export__success-icon" aria-hidden="true">✓</div>
          <div class="cutup-viral-export__ready-copy">
            <p class="cutup-viral-export__ready-title">Your viral clip is ready</p>
            <p class="cutup-viral-export__ready-msg">Post-ready MP4 with cinematic captions burned in.</p>
            <dl class="cutup-viral-export__meta" id="cutupExportMeta"></dl>
          </div>
          <a
            class="cutup-viral-export__btn cutup-viral-export__btn--download"
            id="cutupExportDownloadLink"
            href="#"
            download="cutup-viral-export.mp4"
          >Download MP4</a>
          <p class="cutup-viral-export__download-hint">Download handled securely by your browser</p>
          <button type="button" class="cutup-viral-export__preview-toggle" id="cutupExportPreviewToggle">Open preview</button>
          <video class="cutup-viral-export__preview" id="cutupExportPreview" controls playsinline preload="none" hidden></video>
        </div>
      </section>`;

    const btn = container.querySelector('#cutupExportMp4Btn');
    btn?.addEventListener('click', () => startExport(container));
    const styleSelect = container.querySelector('#cutupExportStyleSelect');
    if (styleSelect && !styleSelect.dataset.bound) {
      styleSelect.dataset.bound = '1';
      styleSelect.addEventListener('change', () => {
        const selected = getExportStyleSelection(container);
        applyStyleSelectionToPreset(selected);
      });
    }
    syncStyleSelectFromPreset(container, getActivePresetId());
    if (!global.__cutupExportPresetSyncBound) {
      global.__cutupExportPresetSyncBound = true;
      global.addEventListener?.('cutup:preset-changed', (event) => {
        const mountEl = document.getElementById('cutupViralExportMount');
        if (!mountEl) return;
        const source = event?.detail?.source;
        const incomingPresetId = event?.detail?.selectedPresetId || event?.detail?.presetId || getActivePresetId();
        setSelectedPresetId(incomingPresetId);
        syncPresetCards(incomingPresetId);
        if (source === 'export-style-select') return;
        syncStyleSelectFromPreset(mountEl, incomingPresetId);
      });
    }
    container.querySelector('#cutupExportPreviewToggle')?.addEventListener('click', () => {
      togglePreview(container);
    });
    bindCreatorWallOptIn(container);
    refreshExportButton();
  }

  function hideProgress(container) {
    const wrap = container.querySelector('#cutupExportProgress');
    wrap?.classList.remove('cutup-viral-export__progress--active', 'cutup-viral-export__progress--pulse');
    showNotice(container, '');
  }

  function getCreatorWallOptInRoot() {
    return document.getElementById('cutupCreatorWallOptInMount');
  }

  function syncCreatorWallLivePreview(container) {
    const optRoot = getCreatorWallOptInRoot();
    if (!optRoot || optRoot.hidden) return;
    const check = optRoot.querySelector('#cutupExportOptInCheck');
    if (!check?.checked) {
      global.CutupCreatorWall?.clearDraftPreview?.();
      return;
    }
    global.CutupCreatorWall?.setDraftPreview?.({
      stylePreset: container?.dataset?.cwPresetId || getActivePresetId(),
      creatorName: optRoot.querySelector('#cutupExportOptInName')?.value?.trim() || '',
      socialHandle: optRoot.querySelector('#cutupExportOptInHandle')?.value?.trim() || '',
      feedback:
        optRoot.querySelector('#cutupExportOptInQuote')?.value?.trim() ||
        'Previewing your quote on the Creator Wall…',
      platform: 'youtube',
      countryCode: 'US'
    });
  }

  function bindCreatorWallOptIn(container) {
    const optRoot = getCreatorWallOptInRoot();
    if (!optRoot || optRoot.dataset.bound === '1') return;
    optRoot.dataset.bound = '1';
    const sync = () => syncCreatorWallLivePreview(container);
    optRoot.querySelector('#cutupExportOptInCheck')?.addEventListener('change', (e) => {
      const fields = optRoot.querySelector('#cutupExportOptInFields');
      if (fields) fields.hidden = !e.target.checked;
      sync();
    });
    ['#cutupExportOptInName', '#cutupExportOptInHandle', '#cutupExportOptInQuote'].forEach((sel) => {
      optRoot.querySelector(sel)?.addEventListener('input', sync);
    });
    optRoot.querySelector('#cutupExportOptInSubmit')?.addEventListener('click', () => {
      submitCreatorWallOptIn(container);
    });
  }

  function hideCreatorWallOptIn(container) {
    const opt = getCreatorWallOptInRoot();
    if (opt) opt.hidden = true;
    const note = opt?.querySelector('#cutupExportOptInNote');
    if (note) {
      note.hidden = true;
      note.textContent = '';
    }
    global.CutupCreatorWall?.clearDraftPreview?.();
  }

  function showCreatorWallOptIn(container, data, jobId) {
    const opt = getCreatorWallOptInRoot();
    if (!opt) return;
    opt.hidden = false;
    if (container) {
      container.dataset.cwExportJobId = jobId || '';
      container.dataset.cwPresetId = data.presetId || getActivePresetId();
      container.dataset.cwProcessingSec = data.renderDurationSec != null ? String(data.renderDurationSec) : '';
      container.dataset.cwResolution = data.resolution || '';
    }
    const check = opt.querySelector('#cutupExportOptInCheck');
    const fields = opt.querySelector('#cutupExportOptInFields');
    if (check) check.checked = false;
    if (fields) fields.hidden = true;
    bindCreatorWallOptIn(container);
  }

  async function submitCreatorWallOptIn(container) {
    const sessionId = getSessionId();
    if (!sessionId) {
      showError(container, 'Sign in to share on the Creator Wall.');
      return;
    }
    const optRoot = getCreatorWallOptInRoot();
    const check = optRoot?.querySelector('#cutupExportOptInCheck');
    if (!check?.checked) return;

    const quote = optRoot?.querySelector('#cutupExportOptInQuote')?.value?.trim() || '';
    if (quote.length < 8) {
      const note = optRoot?.querySelector('#cutupExportOptInNote');
      if (note) {
        note.hidden = false;
        note.textContent = 'Add a short quote (at least 8 characters).';
      }
      return;
    }

    const btn = optRoot?.querySelector('#cutupExportOptInSubmit');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/creator-wall?action=submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
        body: JSON.stringify({
          optIn: true,
          stylePreset: container.dataset.cwPresetId || getActivePresetId(),
          feedback: quote,
          creatorName: optRoot?.querySelector('#cutupExportOptInName')?.value?.trim() || '',
          socialHandle: optRoot?.querySelector('#cutupExportOptInHandle')?.value?.trim() || '',
          exportJobId: container.dataset.cwExportJobId || null,
          processingSec: container.dataset.cwProcessingSec || null,
          resolution: container.dataset.cwResolution || null,
          platform: 'youtube',
          language: global.cutupLastTranscription?.language || 'en'
        })
      });
      const data = await res.json().catch(() => ({}));
      const note = optRoot?.querySelector('#cutupExportOptInNote');
      if (note) {
        note.hidden = false;
        note.textContent = data.message || (res.ok ? 'Submitted — pending review. Thank you!' : data.error || 'Could not submit.');
      }
      if (res.ok) hideCreatorWallOptIn(container);
    } catch (err) {
      console.error('[video-export] creator wall opt-in', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function restoreReadyExport(container, jobId) {
    const sessionId = getSessionId();
    if (!sessionId || !jobId || !container) return false;
    if (!container.dataset.mounted) {
      mount(container);
      container.dataset.mounted = '1';
    }
    try {
      const res = await fetch(
        `/api/export-video?action=status&jobId=${encodeURIComponent(jobId)}&session=${encodeURIComponent(sessionId)}`,
        { headers: { 'X-Session-Id': sessionId } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !isExportReady(data)) return false;
      container.dataset.readyJobId = jobId;
      showReadyInstant(container, sessionId, jobId, data);
      const btn = container.querySelector('#cutupExportMp4Btn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Export again';
      }
      refreshExportButton();
      return true;
    } catch {
      return false;
    }
  }

  function hideDownloadReady(container) {
    hideCreatorWallOptIn(container);
    const ready = container.querySelector('#cutupExportReady');
    if (ready) ready.hidden = true;
    const video = container.querySelector('#cutupExportPreview');
    if (video) {
      video.pause?.();
      video.removeAttribute('src');
      video.hidden = true;
    }
    const toggle = container.querySelector('#cutupExportPreviewToggle');
    if (toggle) {
      toggle.textContent = 'Open preview';
      toggle.setAttribute('aria-expanded', 'false');
    }
  }

  function resolveRenderDurationSec(data) {
    const clientSec =
      exportStartedAt > 0 ? Math.max(1, Math.round((Date.now() - exportStartedAt) / 1000)) : null;
    const serverSec =
      data?.renderDurationSec != null ? Math.max(1, Math.round(Number(data.renderDurationSec))) : null;
    if (clientSec != null && serverSec != null) {
      return Math.max(clientSec, serverSec);
    }
    return clientSec ?? serverSec ?? null;
  }

  function populateMeta(container, data) {
    const meta = container.querySelector('#cutupExportMeta');
    if (!meta) return;

    const renderSec = resolveRenderDurationSec(data);
    const qualityLabel = data.quality === 'hq' ? 'High quality' : 'Fast preview';
    const rows = [
      ['Style', data.presetName || data.presetId || getActivePresetId()],
      ['Resolution', data.resolution || '—'],
      ['Render time', renderSec != null ? formatDuration(renderSec) : '—'],
      ['File size', data.fileSizeLabel || (data.fileSizeBytes != null ? `${data.fileSizeBytes} B` : '—')],
      ['Quality', qualityLabel]
    ];

    if (data.videoDurationSec != null) {
      rows.splice(3, 0, ['Clip length', formatDuration(data.videoDurationSec)]);
    }

    meta.innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="cutup-viral-export__meta-row"><dt>${label}</dt><dd>${value}</dd></div>`
      )
      .join('');
  }

  function showReadyInstant(container, sessionId, jobId, data) {
    hideProgress(container);
    showError(container, '');

    const downloadUrl = buildExportUrl('download', jobId, sessionId);
    const previewUrl = buildExportUrl('preview', jobId, sessionId);
    const filename = data.downloadFilename || `cutup-viral-${getActivePresetId()}.mp4`;

    const link = container.querySelector('#cutupExportDownloadLink');
    if (link) {
      link.href = downloadUrl;
      link.download = filename;
    }

    const video = container.querySelector('#cutupExportPreview');
    if (video) {
      video.dataset.previewUrl = previewUrl;
      video.hidden = true;
      video.removeAttribute('src');
    }

    populateMeta(container, data);

    const ready = container.querySelector('#cutupExportReady');
    if (ready) {
      ready.hidden = false;
      ready.classList.remove('cutup-viral-export__ready--animate');
      void ready.offsetWidth;
      ready.classList.add('cutup-viral-export__ready--animate');
    }
    const renderSec = resolveRenderDurationSec(data);
    showCreatorWallOptIn(container, { ...data, renderDurationSec: renderSec }, jobId);
  }

  function togglePreview(container) {
    const sessionId = getSessionId();
    const jobId = container.dataset.readyJobId;
    if (!sessionId || !jobId) return;

    const video = container.querySelector('#cutupExportPreview');
    const toggle = container.querySelector('#cutupExportPreviewToggle');
    if (!video || !toggle) return;

    const previewUrl = video.dataset.previewUrl || buildExportUrl('preview', jobId, sessionId);
    const isOpen = !video.hidden;

    if (isOpen) {
      video.pause?.();
      video.hidden = true;
      toggle.textContent = 'Open preview';
      toggle.setAttribute('aria-expanded', 'false');
      return;
    }

    if (!video.getAttribute('src')) {
      video.src = previewUrl;
    }
    video.hidden = false;
    video.load?.();
    video.play?.().catch(() => {});
    toggle.textContent = 'Hide preview';
    toggle.setAttribute('aria-expanded', 'true');
  }

  function refreshExportButton() {
    const btn = document.getElementById('cutupExportMp4Btn');
    if (!btn) return;
    const check = canExport();
    btn.disabled = !check.ok;
    btn.title = check.ok ? 'Render MP4 with burned-in subtitles' : check.reason;
  }

  function loadExportHistory() {
    try {
      const raw = global.localStorage?.getItem(HISTORY_KEY);
      exportHistory = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(exportHistory)) exportHistory = [];
    } catch {
      exportHistory = [];
    }
  }

  function saveExportHistory() {
    try {
      global.localStorage?.setItem(HISTORY_KEY, JSON.stringify(exportHistory.slice(0, 20)));
    } catch {
      /* ignore */
    }
  }

  function upsertHistoryEntry(data) {
    const id = data.jobId;
    if (!id) return;
    const idx = exportHistory.findIndex((e) => e.jobId === id);
    const entry = {
      jobId: id,
      stage: data.stage,
      pipelineLabel: data.pipelineLabel || data.stageLabel,
      presetName: data.presetName || data.presetId,
      quality: data.quality,
      progress: data.progress,
      status:
        data.stage === 'failed' || data.stage === 'cancelled'
          ? 'failed'
          : data.outputReady || data.stage === 'ready_to_download'
            ? 'completed'
            : 'processing',
      updatedAt: Date.now(),
      error: data.error || null
    };
    if (idx >= 0) exportHistory[idx] = { ...exportHistory[idx], ...entry };
    else exportHistory.unshift(entry);
    exportHistory = exportHistory.slice(0, 20);
    saveExportHistory();
  }

  function formatClock(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  function formatWait(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (!s) return '—';
    if (s < 60) return `~${s}s`;
    const m = Math.ceil(s / 60);
    return `~${m} min`;
  }

  function renderQueuePanel(container, data) {
    const panel = container.querySelector('#cutupExportQueuePanel');
    if (!panel) return;
    const queued = data.isQueued && data.queuePosition > 0;
    panel.hidden = !queued;
    if (!queued) return;
    const headline = container.querySelector('#cutupExportQueueHeadline');
    const pos = container.querySelector('#cutupExportQueuePosition');
    const ahead = container.querySelector('#cutupExportQueueAhead');
    const wait = container.querySelector('#cutupExportQueueWait');
    const done = container.querySelector('#cutupExportQueueDone');
    if (headline) headline.textContent = `You are #${data.queuePosition} in queue`;
    if (pos) pos.textContent = String(data.queuePosition);
    if (ahead) ahead.textContent = String(data.jobsAhead ?? 0);
    if (wait) wait.textContent = formatWait(data.estimatedWaitSec ?? data.queueEtaSec);
    if (done) done.textContent = formatClock(data.estimatedCompletionAt);
  }

  function renderPipelineSteps(container, data) {
    const list = container.querySelector('#cutupExportPipeline');
    if (!list) return;
    const stages = Array.isArray(data.pipelineStages) ? data.pipelineStages : [];
    const step = Number(data.pipelineStep) || 0;
    if (!stages.length) {
      list.innerHTML = '';
      list.hidden = true;
      return;
    }
    list.hidden = false;
    list.innerHTML = stages
      .map((s) => {
        const done = step > s.step;
        const active = step === s.step;
        const cls = done ? 'is-done' : active ? 'is-active' : '';
        return `<li class="cutup-export-pipeline__item ${cls}"><span class="cutup-export-pipeline__dot" aria-hidden="true"></span>${s.label}</li>`;
      })
      .join('');
  }

  function renderHistoryPanel(container) {
    const wrap = container.querySelector('#cutupExportHistory');
    const list = container.querySelector('#cutupExportHistoryList');
    if (!wrap || !list) return;
    if (!exportHistory.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    list.innerHTML = exportHistory
      .map((e) => {
        const badge =
          e.status === 'completed' ? 'completed' : e.status === 'failed' ? 'failed' : 'processing';
        const retry =
          e.status === 'failed'
            ? `<button type="button" class="cutup-export-history__retry" data-retry-job="${e.jobId}">Retry</button>`
            : '';
        return `<li class="cutup-export-history__row cutup-export-history__row--${badge}">
          <span class="cutup-export-history__label">${e.presetName || 'Export'} · ${e.pipelineLabel || e.stage}</span>
          <span class="cutup-export-history__badge">${badge}</span>
          ${retry}
        </li>`;
      })
      .join('');
    list.querySelectorAll('[data-retry-job]').forEach((btn) => {
      btn.addEventListener('click', () => startExport(container));
    });
  }

  function setProgress(container, stage, progress, etaSec, labelText) {
    const wrap = container.querySelector('#cutupExportProgress');
    const label = container.querySelector('#cutupExportStageLabel');
    const pct = container.querySelector('#cutupExportPct');
    const fill = container.querySelector('#cutupExportFill');
    const eta = container.querySelector('#cutupExportEta');
    wrap?.classList.add('cutup-viral-export__progress--active');
    wrap?.classList.toggle('cutup-viral-export__progress--pulse', stage === 'rendering' || stage === 'rendering_video');
    if (label) label.textContent = labelText || STAGE_LABELS[stage] || stage;
    if (pct) pct.textContent = `${Math.round(progress || 0)}%`;
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, progress || 0))}%`;
    if (eta) {
      if (etaSec > 0 && !isExportReady({ stage })) {
        eta.hidden = false;
        eta.textContent = `~${etaSec}s remaining`;
      } else {
        eta.hidden = true;
      }
    }
  }

  function applyExportStatus(container, sessionId, data) {
    if (!data) return;
    lastServerEventAt = Date.now();
    upsertHistoryEntry(data);
    renderQueuePanel(container, data);
    renderPipelineSteps(container, data);
    renderHistoryPanel(container);

    if (isExportReady(data)) {
      if (completedHandled) return;
      completedHandled = true;
      const jobIdForDownload = data.jobId || activeJobId;
      stopStream();
      showNotice(container, '');
      showReadyInstant(container, sessionId, jobIdForDownload, data);
      container.dataset.readyJobId = jobIdForDownload;
      global.CutupWorkspaceAutosave?.scheduleSave?.();
      const btn = container.querySelector('#cutupExportMp4Btn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Export again';
      }
      activeJobId = null;
      refreshExportButton();
      return;
    }

    if (data.stage === 'failed' || data.stage === 'cancelled') {
      stopStream();
      showError(container, toFriendlyRenderError(data.error || 'Render failed'));
      const btn = container.querySelector('#cutupExportMp4Btn');
      if (btn) btn.disabled = false;
      activeJobId = null;
      refreshExportButton();
      return;
    }

    if (typeof data.progress === 'number' && data.progress > lastProgressVal) {
      lastProgressVal = data.progress;
      lastProgressAt = Date.now();
    }
    const label = data.pipelineLabel || data.stageLabel || data.subStageLabel || STAGE_LABELS[data.stage] || data.stage;
    const etaForUi = data.isQueued
      ? data.estimatedTotalSec ?? data.queueEtaSec ?? data.etaSec
      : data.etaSec;
    setProgress(container, data.stage, data.progress, etaForUi, label);

    const elapsed = Date.now() - exportStartedAt;
    if (
      container.dataset.exportQuality === 'hq' &&
      elapsed >= HQ_NOTICE_MS &&
      !isExportReady(data) &&
      data.stage !== 'failed' &&
      data.stage !== 'cancelled'
    ) {
      showNotice(container, 'HQ cinematic rendering takes longer for premium exports.');
    }
  }

  function showError(container, msg) {
    const el = container.querySelector('#cutupExportError');
    if (el) {
      el.hidden = !msg;
      el.textContent = msg || '';
    }
  }

  function showNotice(container, msg) {
    const el = container.querySelector('#cutupExportNotice');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function toFriendlyRenderError(msg) {
    const text = String(msg || '').trim();
    if (/PRESET_NOT_APPLIED/i.test(text)) {
      return 'Selected subtitle style could not be applied. Please choose a valid preset.';
    }
    if (/timed out|timeout|ffmpeg|stalled/i.test(text)) {
      return 'HQ cinematic rendering takes longer for premium exports. Please try Fast preview or a shorter clip.';
    }
    return text || 'Export failed. Please try again.';
  }

  function stopStream() {
    if (exportEventSource) {
      exportEventSource.close();
      exportEventSource = null;
    }
    if (stallWatchTimer) {
      clearInterval(stallWatchTimer);
      stallWatchTimer = null;
    }
  }

  function connectExportStream(container, sessionId, jobId) {
    stopStream();
    const url = `/api/export-video?action=stream&jobId=${encodeURIComponent(jobId)}&session=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(url);
    exportEventSource = es;
    lastServerEventAt = Date.now();

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        applyExportStatus(container, sessionId, data);
      } catch (err) {
        console.warn('[video-export] SSE parse', err);
      }
    });
    es.onerror = () => {
      if (completedHandled || !activeJobId) {
        stopStream();
        return;
      }
      stopStream();
      pollStatusOnce(container, sessionId).catch(() => {});
    };

    stallWatchTimer = setInterval(() => {
      if (!activeJobId || completedHandled) return;
      if (Date.now() - lastServerEventAt > STALL_MS) {
        stopStream();
        showError(
          container,
          'Render is taking longer than expected. Try Fast preview or a shorter clip, then export again.'
        );
        const btn = container.querySelector('#cutupExportMp4Btn');
        if (btn) btn.disabled = false;
        activeJobId = null;
      }
    }, 15000);
  }

  async function pollStatusOnce(container, sessionId) {
    if (!activeJobId) return;
    const res = await fetch(
      `/api/export-video?action=status&jobId=${encodeURIComponent(activeJobId)}&session=${encodeURIComponent(sessionId)}`,
      { headers: { 'X-Session-Id': sessionId } }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) applyExportStatus(container, sessionId, data);
  }

  async function startExport(container) {
    const sessionId = getSessionId();
    if (!sessionId) {
      showError(container, 'Sign in to export video.');
      return;
    }

    const btn = container.querySelector('#cutupExportMp4Btn');
    const quality = container.querySelector('#cutupExportQuality')?.value || 'fast';
    container.dataset.exportQuality = quality;
    let styleSelection;
    try {
      styleSelection = getExportStyleSelection(container);
    } catch (err) {
      showError(container, err?.message || 'PRESET_NOT_APPLIED');
      return;
    }
    applyStyleSelectionToPreset(styleSelection);
    global.CutupSubtitleStyles?.refreshPreview?.();
    const selectedPresetId = styleSelection.selectedPresetId || styleSelection.presetId;
    const captionMode = styleSelection.captionMode;
    const styleMode = styleSelection.styleMode;
    const selectedVersion = getSelectedVersionKey();
    const check = canExport();
    if (!check.ok) {
      showError(container, check.reason);
      return;
    }
    showError(container, '');
    showNotice(container, '');
    delete container.dataset.hqFastSuggestion;
    hideDownloadReady(container);
    delete container.dataset.readyJobId;
    completedHandled = false;
    if (btn) btn.disabled = true;
    stopStream();
    loadExportHistory();
    lastProgressVal = 0;
    container.querySelector('#cutupExportPipeline')?.removeAttribute('hidden');
    setProgress(container, 'queued', 0, null, 'Joining export queue…');

    try {
      let res;
      const { payload, hasFile } = check;
      const resolvedPresetId = selectedPresetId;
      const resolvedPayload = payload?.exportDoc
        ? {
            ...payload,
            exportDoc: {
              ...payload.exportDoc,
              preset: {
                ...(payload.exportDoc.preset || {}),
                id: resolvedPresetId,
                name: STYLE_OPTIONS[styleSelection.selectedId]?.label || resolvedPresetId
              }
            }
          }
        : payload;
      console.log('[render-payload]', {
        selectedPresetId: resolvedPresetId,
        selectedVersion,
        renderQuality: quality,
        exportMeta: resolvedPayload.exportMeta || null,
        exportCueCount: resolvedPayload.exportDoc?.cues?.length || resolvedPayload.segments?.length || 0,
        firstExportCue: resolvedPayload.exportDoc?.cues?.[0] || resolvedPayload.segments?.[0] || null
      });
      const sourceUrl = resolveSourceUrl();

      if (hasFile) {
        const fd = new FormData();
        fd.append('video', global.cutupLastSourceVideoFile);
        fd.append('session', sessionId);
        fd.append('presetId', resolvedPresetId);
        fd.append('selectedPresetId', resolvedPresetId);
        fd.append('selectedVersion', selectedVersion);
        fd.append('quality', quality);
        fd.append('captionMode', captionMode);
        fd.append('styleMode', styleMode);
        fd.append('segments', JSON.stringify(resolvedPayload.segments || []));
        const captionForensics = global.CutupCaptionForensics?.getPayloadForExport?.();
        if (captionForensics) {
          fd.append('captionForensics', JSON.stringify(captionForensics));
        }
        if (resolvedPayload.exportDoc) {
          fd.append('exportDoc', JSON.stringify(resolvedPayload.exportDoc));
        }
        res = await fetch('/api/export-video', {
          method: 'POST',
          headers: { 'X-Session-Id': sessionId },
          body: fd
        });
      } else {
        res = await fetch('/api/export-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId
          },
          body: JSON.stringify({
            session: sessionId,
            presetId: resolvedPresetId,
            selectedPresetId: resolvedPresetId,
            selectedVersion,
            quality,
            captionMode,
            styleMode,
            sourceUrl,
            exportDoc: resolvedPayload.exportDoc || undefined,
            segments: resolvedPayload.segments || undefined,
            captionForensics: global.CutupCaptionForensics?.getPayloadForExport?.() || undefined
          })
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `Export failed (${res.status})`);
      }

      activeJobId = data.jobId;
      exportStartedAt = Date.now();
      lastProgressAt = exportStartedAt;
      if (data.status) applyExportStatus(container, sessionId, data.status);
      connectExportStream(container, sessionId, data.jobId);
    } catch (err) {
      console.error('[video-export]', err);
      showError(container, toFriendlyRenderError(err.message || 'Export failed'));
      if (btn) btn.disabled = false;
      refreshExportButton();
    }
  }

  function initAfterResults() {
    const container = document.getElementById('cutupViralExportMount');
    if (!container) return;
    container.hidden = false;
    if (!container.dataset.mounted) {
      mount(container);
      container.dataset.mounted = '1';
    }
    loadExportHistory();
    renderHistoryPanel(container);
    refreshExportButton();
  }

  function destroy() {
    stopStream();
    activeJobId = null;
    const mountEl = document.getElementById('cutupViralExportMount');
    if (mountEl) {
      mountEl.innerHTML = '';
      mountEl.hidden = true;
      delete mountEl.dataset.mounted;
      delete mountEl.dataset.readyJobId;
    }
  }

  global.CutupViralExport = {
    mount,
    initAfterResults,
    refreshExportButton,
    restoreReadyExport,
    destroy,
    canExport
  };
})(typeof window !== 'undefined' ? window : globalThis);
