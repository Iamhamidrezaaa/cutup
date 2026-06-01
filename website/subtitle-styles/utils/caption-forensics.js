/**
 * Client-side caption forensic trace (preview path only).
 */
(function (global) {
  'use strict';

  const MAX = 10;

  function isEnabled() {
    return global.CAPTION_FORENSIC !== false && global.CAPTION_FORENSIC !== '0';
  }

  function roundSec(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(3)) : null;
  }

  /**
   * @param {{ start, end, text }[]} segments active preview segments (translated or original)
   * @param {string} presetId
   * @param {{ transcriptSegments?: object[] }} [ctx]
   */
  function buildPreviewForensicRows(segments, presetId, ctx = {}) {
    const list = (Array.isArray(segments) ? segments : []).slice(0, MAX);
    const transcript = Array.isArray(ctx.transcriptSegments) ? ctx.transcriptSegments : [];
    const Layout = global.CutupTextLayout;
    const Presets = global.CutupStylePresets;
    const preset = Presets?.getPreset?.(presetId) || { layout: { wordsPerLineMin: 2, wordsPerLineMax: 6 } };

    return list.map((seg, cueIndex) => {
      const lines =
        Layout?.layoutLines?.(String(seg.text || ''), preset.layout || {}) || [String(seg.text || '')];
      const tr = transcript[cueIndex];
      return {
        cueIndex,
        originalStart: roundSec(tr?.start ?? seg.start),
        originalEnd: roundSec(tr?.end ?? seg.end),
        previewStart: roundSec(seg.start),
        previewEnd: roundSec(seg.end),
        exportStart: null,
        exportEnd: null,
        text: String(seg.text || '').slice(0, 200),
        segmentedLines: lines,
        segmentedLinesPreview: lines,
        stylePreset: presetId,
        previewRenderer: 'CutupStyleRenderer',
        exportRenderer: null
      };
    });
  }

  function logPreviewForensics(segments, presetId, ctx = {}) {
    if (!isEnabled()) return [];
    const rows = buildPreviewForensicRows(segments, presetId, ctx);
    global.cutupCaptionForensicsPreview = {
      presetId,
      rows,
      capturedAt: Date.now(),
      transcriptSegments: ctx.transcriptSegments || null
    };
    for (const row of rows) {
      console.log('[caption-forensics]', JSON.stringify(row));
    }
    return rows;
  }

  function getTranscriptSegments() {
    if (global.CutupSubtitleVersions?.versions?.original?.segments?.length) {
      return global.CutupSubtitleVersions.versions.original.segments;
    }
    if (Array.isArray(global.cutupLastTranscription?.segments)) {
      return global.cutupLastTranscription.segments;
    }
    return [];
  }

  function getPayloadForExport() {
    const preview = global.cutupCaptionForensicsPreview;
    if (!preview?.rows?.length) return null;
    return {
      previewRows: preview.rows,
      stylePreset: preview.presetId,
      transcriptSegments: preview.transcriptSegments || getTranscriptSegments(),
      translatedSegments:
        global.CutupSubtitleVersions?.getActiveVersion?.()?.key === 'original'
          ? null
          : global.CutupSubtitleVersions?.getActiveSegments?.() || null
    };
  }

  global.CutupCaptionForensics = {
    buildPreviewForensicRows,
    logPreviewForensics,
    getPayloadForExport,
    getTranscriptSegments
  };
})(typeof window !== 'undefined' ? window : globalThis);
