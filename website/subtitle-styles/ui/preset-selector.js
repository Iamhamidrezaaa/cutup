/**
 * Creator identity preset picker — horizontal cards, live preview hook.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'cutup_style_preset';

  function paintActiveCards(id) {
    const visualId = id === 'clean-srt' ? 'ali-abdaal' : id;
    document.querySelectorAll('.cutup-preset-card').forEach((card) => {
      const on = card.getAttribute('data-preset-id') === visualId;
      card.classList.toggle('cutup-preset-card--active', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function getActivePresetId() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && global.CutupStylePresets?.PRESETS?.[v]) return v;
    } catch {
      /* ignore */
    }
    return global.CutupStylePresets?.DEFAULT_PRESET_ID || 'hormozi';
  }

  function setActivePresetId(id, source = 'unknown') {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    global.cutupActiveStylePreset = id;
    global.cutupSelectedPresetId = id;
    paintActiveCards(id);
    global.dispatchEvent?.(
      new CustomEvent('cutup:preset-changed', {
        detail: { presetId: id, selectedPresetId: id, source }
      })
    );
  }

  function mount(container, { onChange } = {}) {
    if (!container || !global.CutupStylePresets) return;
    const presets = global.CutupStylePresets.listPresets();
    let active = getActivePresetId();
    setActivePresetId(active, 'init');

    container.innerHTML = `
      <div class="cutup-preset-bar" role="group" aria-label="Subtitle style presets">
        <div class="cutup-preset-bar__head">
          <h3 class="cutup-preset-bar__title">Creator style</h3>
          <p class="cutup-preset-bar__sub">Pick an identity — preview updates instantly</p>
        </div>
        <div class="cutup-preset-scroll" tabindex="0">
          ${presets
            .map(
              (p) => `
            <button type="button" class="cutup-preset-card${p.id === active ? ' cutup-preset-card--active' : ''}"
              data-preset-id="${p.id}"
              aria-pressed="${p.id === active}"
              style="--card-gradient:${p.cardGradient}">
              <span class="cutup-preset-card__mock" aria-hidden="true">
                <span class="cutup-preset-card__line cutup-preset-card__line--a">YOUR</span>
                <span class="cutup-preset-card__line cutup-preset-card__line--b">HOOK</span>
              </span>
              <span class="cutup-preset-card__name">${p.name}</span>
              <span class="cutup-preset-card__tag">${p.tagline}</span>
            </button>`
            )
            .join('')}
        </div>
      </div>`;

    container.querySelectorAll('[data-preset-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-preset-id');
        if (!id || id === active) return;
        active = id;
        setActivePresetId(id, 'card');
        if (typeof onChange === 'function') onChange(id);
      });
    });
  }

  global.CutupPresetSelector = {
    mount,
    getActivePresetId,
    setActivePresetId,
    STORAGE_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
