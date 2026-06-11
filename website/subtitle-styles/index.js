/**
 * Cutup Subtitle Styles — facade for preset preview + export payloads.
 */
(function (global) {
  'use strict';

  function getSegmentsFromSrt(srtContent) {
    if (typeof global.parseSRTToSegments === 'function') {
      return global.parseSRTToSegments(String(srtContent || ''));
    }
    return [];
  }

  function refreshPreview() {
    const stage = document.getElementById('srtStyledPreview');
    const mount = document.getElementById('cutupStylePresetsMount');
    if (!stage || !global.CutupStyleRenderer) return;

    const presetId =
      global.cutupSelectedPresetId ||
      global.cutupActiveStylePreset ||
      global.CutupPresetSelector?.getActivePresetId?.() ||
      'hormozi';
    global.cutupSelectedPresetId = presetId;

    let segments = [];
    if (global.CutupSubtitleClean?.getMasterBurnCues) {
      try {
        segments = global.CutupSubtitleClean.getMasterBurnCues();
      } catch (err) {
        console.warn('[subtitle-styles] master burn cues unavailable:', err?.message || err);
      }
    }
    if (!segments.length && global.CutupSubtitleVersions?.getActiveSegments) {
      const active = global.CutupSubtitleVersions.getActiveSegments();
      if (active.length) segments = active;
    }
    if (!segments.length && Array.isArray(global.cutupSourceSegments) && global.cutupSourceSegments.length) {
      segments = global.cutupSourceSegments;
    } else if (!segments.length && Array.isArray(global.cutupLastTranscription?.segments) && global.cutupLastTranscription.segments.length) {
      segments = global.cutupLastTranscription.segments;
    } else if (!segments.length && typeof global.getStoredSrtContent === 'function') {
      segments = getSegmentsFromSrt(global.getStoredSrtContent());
    } else if (!segments.length && global.currentSrtContent) {
      segments = getSegmentsFromSrt(global.currentSrtContent);
    }

    global.CutupStyleRenderer.render(stage, segments, presetId);
    try {
      global.CutupCaptionForensics?.logPreviewForensics?.(segments, presetId, {
        transcriptSegments: global.CutupCaptionForensics?.getTranscriptSegments?.() || []
      });
    } catch (err) {
      console.warn('[caption-forensics] preview logging skipped:', err?.message);
    }
    global.cutupStyleExportDoc = global.CutupStyleExport?.buildExportDocument?.(segments, presetId) || null;
    global.CutupViralExport?.refreshExportButton?.();

    const rawEl = document.getElementById('srtPreviewRaw');
    if (rawEl && typeof global.buildCleanSrtFromSource === 'function') {
      rawEl.textContent = global.buildCleanSrtFromSource() || '';
    } else if (rawEl && typeof global.getStoredSrtContent === 'function') {
      rawEl.textContent = global.getStoredSrtContent() || '';
    }

  }

  function initAfterResults() {
    const mount = document.getElementById('cutupStylePresetsMount');
    const stage = document.getElementById('srtStyledPreview');
    if (!mount || !stage) return;

    if (global.CutupPresetSelector) {
      global.CutupPresetSelector.mount(mount, {
        onChange: () => refreshPreview()
      });
    }
    refreshPreview();
  }

  function destroy() {
    const mount = document.getElementById('cutupStylePresetsMount');
    const stage = document.getElementById('srtStyledPreview');
    if (mount) mount.innerHTML = '';
    if (stage) stage.innerHTML = '';
  }

  global.CutupSubtitleStyles = {
    initAfterResults,
    refreshPreview,
    destroy,
    getExportDocument: () => global.cutupStyleExportDoc
  };
})(typeof window !== 'undefined' ? window : globalThis);
