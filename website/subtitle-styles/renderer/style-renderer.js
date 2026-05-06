/**
 * Renders styled subtitle cues from segments + preset (DOM preview).
 */
(function (global) {
  'use strict';

  const Emphasis = () => global.CutupEmphasisEngine;
  const Layout = () => global.CutupTextLayout;
  const Presets = () => global.CutupStylePresets;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const HANDLERS = {
    hormozi(token) {
      if (!token.emphasize) return '';
      if (token.types.includes('power') || token.score >= 3) return 'cutup-em cutup-em--hormozi-power';
      return 'cutup-em cutup-em--hormozi';
    },
    mrbeast(token) {
      if (!token.emphasize) return '';
      if (token.types.includes('emotional') || token.types.includes('caps')) return 'cutup-em cutup-em--mrbeast-burst';
      return 'cutup-em cutup-em--mrbeast';
    },
    neon(token) {
      if (!token.emphasize) return '';
      return 'cutup-em cutup-em--neon';
    },
    luxury(token) {
      if (!token.emphasize) return '';
      return 'cutup-em cutup-em--luxury';
    },
    minimal(token) {
      if (!token.emphasize) return '';
      if (token.types.includes('number')) return 'cutup-em cutup-em--soft';
      return '';
    },
    default(token) {
      return token.emphasize ? 'cutup-em' : '';
    }
  };

  function renderTokenSpan(token, handlerId) {
    if (token.isSpace) return escapeHtml(token.text);
    const fn = HANDLERS[handlerId] || HANDLERS.default;
    const cls = fn(token);
    const inner = escapeHtml(token.text);
    return cls ? `<span class="${cls}">${inner}</span>` : inner;
  }

  function renderLineHtml(line, preset) {
    const handlerId = preset.emphasis.handler;
    const tokens = Emphasis().analyzeTextWithEmphasis
      ? Emphasis().analyzeTextWithEmphasis(line, handlerId)
      : Emphasis().analyzeText(line);
    return tokens.map((t) => renderTokenSpan(t, handlerId)).join('');
  }

  function formatClock(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function cssVarsFromPreset(preset) {
    const t = preset.typography;
    const c = preset.colors;
    return [
      `--cutup-font:${t.fontFamily}`,
      `--cutup-weight:${t.fontWeight}`,
      `--cutup-size:${t.fontSize}`,
      `--cutup-lh:${t.lineHeight}`,
      `--cutup-ls:${t.letterSpacing}`,
      `--cutup-transform:${t.textTransform || 'none'}`,
      `--cutup-color:${c.text}`,
      `--cutup-em:${c.emphasis}`,
      `--cutup-accent:${c.accent}`,
      `--cutup-bg:${c.background}`,
      `--cutup-shadow:${c.shadow || 'none'}`,
      `--cutup-align:${preset.layout.align || 'center'}`,
      `--cutup-max-w:${preset.layout.maxWidth || '92%'}`,
      `--cutup-motion-dur:${preset.motion.durationMs}ms`,
      `--cutup-motion-stagger:${preset.motion.staggerMs}ms`
    ].join(';');
  }

  /**
   * @param {HTMLElement} container
   * @param {{ start, end, text }[]} segments
   * @param {string} presetId
   */
  function render(container, segments, presetId) {
    if (!container) return;
    const preset = Presets().getPreset(presetId);
    let list = Array.isArray(segments) ? segments.filter((s) => s && s.text) : [];
    const selectedPresetId = global.cutupSelectedPresetId || presetId;
    const previewMode = selectedPresetId === 'clean-srt' ? 'accurate' : global.cutupRenderCaptionMode || 'viral';
    if (global.CutupSubtitleClean?.prepareSegmentsForMode) {
      list = global.CutupSubtitleClean.prepareSegmentsForMode(list, previewMode);
    } else if (global.CutupSubtitleClean?.prepareSegments) {
      list = global.CutupSubtitleClean.prepareSegments(list);
    }
    const previewLimit = 24;
    const slice = list.slice(0, previewLimit);

    const cuesHtml = slice
      .map((seg, i) => {
        const lines = Layout().layoutLines(seg.text, preset.layout);
        const linesHtml = lines
          .map(
            (line, li) =>
              `<div class="cutup-cue-line cutup-cue-line--${li}" data-motion="${escapeHtml(preset.motion.cueEnter)}">${renderLineHtml(line, preset)}</div>`
          )
          .join('');
        return `
          <article class="cutup-cue" data-start="${seg.start}" style="--cue-i:${i}">
            <time class="cutup-cue-time" datetime="${seg.start}s">${formatClock(seg.start)}</time>
            <div class="cutup-cue-body">${linesHtml}</div>
          </article>`;
      })
      .join('');

    const more =
      list.length > previewLimit
        ? `<p class="cutup-style-more">+ ${list.length - previewLimit} more cues in export</p>`
        : '';

    const rtl = list.some((s) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(s.text || '')));
    container.classList.add('cutup-subtitle-stage--updating');
    container.setAttribute('data-preset', preset.id);
    container.toggleAttribute('data-rtl', rtl);
    container.style.cssText = cssVarsFromPreset(preset);
    if (rtl) {
      container.style.setProperty('--cutup-font', "'Vazirmatn', 'Noto Sans Arabic', sans-serif");
      container.style.setProperty('--cutup-size', 'clamp(1.05rem, 4.2vw, 1.35rem)');
      container.style.setProperty('--cutup-lh', '1.55');
      container.style.direction = 'rtl';
    } else {
      container.style.removeProperty('direction');
    }
    container.innerHTML = `
      <div class="cutup-subtitle-stage__inner">
        ${cuesHtml || '<p class="cutup-style-empty">No subtitle cues to preview.</p>'}
        ${more}
      </div>`;

    requestAnimationFrame(() => {
      container.classList.remove('cutup-subtitle-stage--updating');
      container.classList.add('cutup-subtitle-stage--ready');
    });
  }

  global.CutupStyleRenderer = { render, renderLineHtml, cssVarsFromPreset };
})(typeof window !== 'undefined' ? window : globalThis);
