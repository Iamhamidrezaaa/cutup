/**
 * Styled export frame previews — real caption typography, waveform, timeline.
 */
(function (global) {
  'use strict';

  const PLATFORM_ICON = {
    youtube: '▶',
    tiktok: '♪',
    instagram: '◎',
    podcast: '🎙'
  };

  const DEFAULT_CAPTIONS = {
    hormozi: [
      ['THIS', 'CHANGED'],
      ['MY', 'RETENTION']
    ],
    mrbeast: [
      ['WATCH', 'THIS'],
      ['NEXT']
    ],
    'ali-abdaal': [['Clean', 'professional'], ['hooks']],
    'tiktok-neon': [['Viral', 'energy'], ['NOW']],
    'luxury-minimal': [['Refined', 'story']],
    podcast: [['Key', 'insight'], ['here']]
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getPreset(presetId) {
    return global.CutupStylePresets?.PRESETS?.[presetId] || global.CutupStylePresets?.getPreset?.(presetId);
  }

  function captionFromFeedback(feedback) {
    const words = String(feedback || '')
      .replace(/[^\w\s']/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    if (words.length < 2) return [['REAL', 'OUTPUT']];
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid), words.slice(mid)];
  }

  function getCaptionLines(post) {
    if (Array.isArray(post.captionLines) && post.captionLines.length) return post.captionLines;
    const def = DEFAULT_CAPTIONS[post.stylePreset];
    if (def) return def;
    return captionFromFeedback(post.feedback);
  }

  function captionStyles(preset) {
    if (!preset) {
      return 'font-weight:800;color:#fff;text-transform:uppercase;';
    }
    const t = preset.typography || {};
    const c = preset.colors || {};
    const parts = [
      `font-family:${t.fontFamily || 'Inter,sans-serif'}`,
      `font-weight:${t.fontWeight || 700}`,
      `text-transform:${t.textTransform || 'none'}`,
      `color:${c.text || '#fff'}`
    ];
    return parts.join(';');
  }

  function emphasisStyle(preset) {
    const c = preset?.colors || {};
    return `color:${c.emphasis || '#ffd60a'};`;
  }

  function buildCaptionHtml(post, compact) {
    const preset = getPreset(post.stylePreset);
    const lines = getCaptionLines(post);
    const baseStyle = captionStyles(preset);
    const emStyle = emphasisStyle(preset);
    const size = compact ? 'cw-caption--sm' : '';

    const inner = lines
      .map((words, li) => {
        const spans = words
          .map((w, wi) => {
            const em = wi === 1 || (lines.length === 1 && wi === 0);
            return `<span class="cw-caption__word${em ? ' cw-caption__word--em' : ''}" style="${em ? emStyle : ''}">${escapeHtml(w)}</span>`;
          })
          .join(' ');
        return `<div class="cw-caption__line" style="${baseStyle}">${spans}</div>`;
      })
      .join('');

    return `<div class="cw-caption ${size}">${inner}</div>`;
  }

  function waveformSvg(compact) {
    const w = compact ? 48 : 72;
    const pts = [];
    for (let i = 0; i < w; i += 1) {
      const h = 3 + Math.abs(Math.sin(i * 0.35) * 8) + Math.abs(Math.cos(i * 0.12) * 4);
      pts.push(`${i},${14 - h}`);
    }
    return `<svg class="cw-export-frame__wave" viewBox="0 0 ${w} 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="rgba(129,140,248,0.55)" stroke-width="1.2"/></svg>`;
  }

  function buildExportFrame(post, compact) {
    const platform = post.platform || 'youtube';
    const icon = PLATFORM_ICON[platform] || '▶';
    const label = escapeHtml(post.presetLabel || post.stylePreset);
    const progress = 35 + (post.id?.length % 40);

    if (post.thumbnailUrl) {
      return `
        <div class="cw-export-frame cw-export-frame--photo${compact ? ' cw-export-frame--compact' : ''}">
          <img src="${escapeHtml(post.thumbnailUrl)}" alt="" loading="lazy" decoding="async" class="cw-export-frame__photo">
          <div class="cw-export-frame__overlay">${buildCaptionHtml(post, compact)}</div>
          <span class="cw-export-frame__platform">${icon}</span>
          <div class="cw-export-frame__chrome">
            ${waveformSvg(compact)}
            <div class="cw-export-frame__timeline"><span class="cw-export-frame__playhead" style="--cw-p:${progress}%"></span></div>
          </div>
        </div>`;
    }

    return `
      <div class="cw-export-frame${compact ? ' cw-export-frame--compact' : ''}" data-preset="${escapeHtml(post.stylePreset)}">
        <div class="cw-export-frame__viewport">
          <div class="cw-export-frame__vignette" aria-hidden="true"></div>
          ${buildCaptionHtml(post, compact)}
          <span class="cw-export-frame__platform" title="${escapeHtml(platform)}">${icon}</span>
          <span class="cw-export-frame__rendered">Rendered</span>
        </div>
        <div class="cw-export-frame__chrome">
          ${waveformSvg(compact)}
          <div class="cw-export-frame__timeline" aria-hidden="true">
            <span class="cw-export-frame__playhead" style="--cw-p:${progress}%"></span>
          </div>
          <span class="cw-export-frame__time">0:${String(12 + (progress % 40)).padStart(2, '0')}</span>
        </div>
      </div>`;
  }

  global.CutupCreatorWallFrames = { buildExportFrame, buildCaptionHtml };
})(typeof window !== 'undefined' ? window : globalThis);
