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
      return 'cutup-em cutup-em--hormozi';
    },
    mrbeast(token) {
      if (!token.emphasize) return '';
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
    minimal() {
      return '';
    },
    default(token) {
      return token.emphasize ? 'cutup-em' : '';
    }
  };

  function renderTokenSpan(token, handlerId, preset, wordIndex, segmentIndex) {
    if (token.isSpace) return escapeHtml(token.text);

    const mode = preset.emphasis?.mode || 'score';

    if (handlerId === 'mrbeast' && mode === 'cycleWords') {
      const cycle = preset.colors.wordCycle || ['#ff4444', '#ffe500', '#44ff88', '#44aaff'];
      const color = cycle[wordIndex % cycle.length];
      return `<span class="cutup-word cutup-word--mrbeast" style="color:${color}">${escapeHtml(token.text)}</span>`;
    }

    if (handlerId === 'hormozi' && token.spoken) {
      return `<span class="cutup-word cutup-word--spoken cutup-em cutup-em--hormozi">${escapeHtml(token.text)}</span>`;
    }

    if (handlerId === 'neon' && token.spoken) {
      const neon =
        (preset.colors.neonColors || ['#00ffff', '#ff00ff'])[segmentIndex % 2] || '#00ffff';
      return `<span class="cutup-word cutup-word--spoken cutup-em cutup-em--neon" style="--cutup-neon:${neon}">${escapeHtml(token.text)}</span>`;
    }

    const fn = HANDLERS[handlerId] || HANDLERS.default;
    const cls = fn(token);
    const inner = escapeHtml(token.text);
    return cls ? `<span class="${cls}">${inner}</span>` : `<span class="cutup-word">${inner}</span>`;
  }

  function renderLineHtml(line, preset, seg, segmentIndex) {
    const handlerId = preset.emphasis.handler;
    const mode = preset.emphasis.mode || 'score';
    let tokens =
      mode === 'spokenWord' && Emphasis().analyzeText
        ? Emphasis().analyzeText(line)
        : Emphasis().analyzeTextWithEmphasis
          ? Emphasis().analyzeTextWithEmphasis(line, handlerId)
          : Emphasis().analyzeText(line);

    const stageRtl = document.getElementById('srtStyledPreview')?.hasAttribute('data-rtl');
    const lineRtl =
      stageRtl ||
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(seg?.text || line || ''));
    if (mode === 'spokenWord' && seg && Emphasis().markSpokenWord) {
      tokens = Emphasis().markSpokenWord(tokens, seg.words, seg.start, seg.end, {
        rtl: lineRtl,
        lineText: line
      });
    }

    let wordIndex = 0;
    return tokens
      .map((t) => {
        if (!t.isSpace) {
          const html = renderTokenSpan(t, handlerId, preset, wordIndex, segmentIndex);
          wordIndex += 1;
          return html;
        }
        return escapeHtml(t.text);
      })
      .join('');
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
   * @param {{ start, end, text, words? }[]} segments
   * @param {string} presetId
   */
  function render(container, segments, presetId) {
    if (!container) return;
    const preset = Presets().getPreset(presetId);
    const list = (Array.isArray(segments) ? segments : []).slice(0, 12);
    const rtl = list.some((s) => /[\u0600-\u06FF]/.test(String(s.text || '')));

    const aspect = Layout()?.detectPreviewAspect?.() || 'horizontal';
    const effectiveLayout = Layout()?.applyAspectToLayout?.(preset.layout, aspect) || preset.layout;

    container.classList.add('cutup-subtitle-stage--updating');
    container.setAttribute('data-preset', presetId);
    container.toggleAttribute('data-rtl', rtl);
    container.classList.toggle('cutup-subtitle-stage--vertical', aspect === 'vertical');
    container.style.cssText = cssVarsFromPreset({
      ...preset,
      layout: { ...preset.layout, ...effectiveLayout }
    });
    if (rtl) {
      container.style.setProperty('--cutup-font', "'Vazirmatn', 'Noto Sans Arabic', sans-serif");
      container.style.setProperty('--cutup-size', 'clamp(1.05rem, 4.2vw, 1.35rem)');
      container.style.setProperty('--cutup-lh', '1.55');
      container.style.direction = 'rtl';
    } else {
      container.style.removeProperty('direction');
    }

    const cuesHtml = list
      .map((seg, i) => {
        let raw = String(seg.text || '').trim().replace(/\s+/g, ' ');
        if (global.CutupSubtitleClean?.clean) {
          raw = global.CutupSubtitleClean.clean(raw);
        }
        if (!raw) return '';
        const rtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(raw);
        const lines = Layout()?.layoutLines?.(raw, effectiveLayout) || [raw];
        const linesHtml = lines
          .map(
            (line, li) =>
              `<div class="cutup-cue-line cutup-cue-line--${li}" data-motion="${escapeHtml(preset.motion.cueEnter)}">${renderLineHtml(line, preset, seg, i)}</div>`
          )
          .join('');
        return `
          <article class="cutup-cue" data-start="${seg.start}" style="--cue-i:${i}"${rtl ? ' dir="rtl"' : ''}>
            <time class="cutup-cue-time" datetime="${seg.start}s">${formatClock(seg.start)}</time>
            <div class="cutup-cue-body"${rtl ? ' dir="rtl" style="unicode-bidi:plaintext"' : ''}>${linesHtml}</div>
          </article>`;
      })
      .join('');

    const more =
      segments.length > list.length
        ? `<p class="cutup-style-more">+${segments.length - list.length} more cues in export</p>`
        : '';

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
