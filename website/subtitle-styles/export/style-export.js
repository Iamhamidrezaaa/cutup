/**
 * Export payload for future ASS / FFmpeg burn-in pipelines.
 */
(function (global) {
  'use strict';

  function buildExportDocument(segments, presetId) {
    const Presets = global.CutupStylePresets;
    const Layout = global.CutupTextLayout;
    const Emphasis = global.CutupEmphasisEngine;
    if (!Presets) return null;

    const preset = Presets.getPreset(presetId);
    const aspect = Layout?.detectPreviewAspect?.() || 'horizontal';
    const effectiveLayout = Layout?.applyAspectToLayout?.(preset.layout, aspect) || preset.layout;
    const cues = (Array.isArray(segments) ? segments : []).map((seg, index) => {
      const raw = String(seg.text || '').trim().replace(/\s+/g, ' ');
      const lines = Layout?.layoutLines?.(raw, effectiveLayout) || [raw];
      const lineTokens = lines.map((line) => Emphasis.analyzeText(line));
      return {
        index: index + 1,
        start: seg.start,
        end: seg.end,
        text: seg.text,
        lines,
        tokens: lineTokens,
        stylePresetId: preset.id
      };
    });

    return {
      format: 'cutup-style-v1',
      preset: {
        id: preset.id,
        name: preset.name,
        version: preset.version,
        typography: preset.typography,
        colors: preset.colors,
        layout: preset.layout,
        emphasis: preset.emphasis,
        motion: preset.motion,
        export: preset.export
      },
      cues,
      generatedAt: new Date().toISOString()
    };
  }

  function toAssStyleLine(preset) {
    const ex = preset.export?.ass || {};
    const parts = [
      `PlayResX:${ex.playResX || 1080}`,
      `PlayResY:${ex.playResY || 1920}`,
      `Fontsize:${ex.fontsize || 48}`,
      `Bold:${ex.bold ? -1 : 0}`,
      `Alignment:${ex.alignment || 2}`
    ];
    if (ex.primaryColour) parts.push(`PrimaryColour:${ex.primaryColour}`);
    if (ex.secondaryColour) parts.push(`SecondaryColour:${ex.secondaryColour}`);
    return parts.join(',');
  }

  global.CutupStyleExport = {
    buildExportDocument,
    toAssStyleLine
  };
})(typeof window !== 'undefined' ? window : globalThis);
