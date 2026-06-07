/**
 * Creator identity preset picker — horizontal cards, live preview hook.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'cutup_style_preset';
  const PREMIUM_PRESET_IDS = new Set(['tiktok-neon', 'luxury-minimal']);

  function resolvePermissions() {
    const sub = global.userSubscription || {};
    if (sub.permissions && typeof sub.permissions === 'object') return sub.permissions;
    const plan = String(sub.plan || 'free').toLowerCase();
    if (global.CutupPlanPermissions?.getPermissions) {
      return global.CutupPlanPermissions.getPermissions(plan);
    }
    return {};
  }

  function presetRequiresUpgrade(id) {
    const perms = resolvePermissions();
    if (PREMIUM_PRESET_IDS.has(id)) return !perms.canUsePremiumStyles;
    return !perms.canUseCreatorStyles;
  }

  function upgradeMessageForPreset(id) {
    if (global.CutupPlanPermissions?.getUpgradeMessage) {
      return PREMIUM_PRESET_IDS.has(id)
        ? global.CutupPlanPermissions.getUpgradeMessage('canUsePremiumStyles')
        : global.CutupPlanPermissions.getUpgradeMessage('canUseCreatorStyles');
    }
    return 'Creator styles are available on Pro and Business plans.';
  }

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
    const presets = global.CutupStylePresets.listCarouselPresets
      ? global.CutupStylePresets.listCarouselPresets()
      : global.CutupStylePresets.listPresets().filter((p) => p.id !== 'clean-srt');
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
        if (presetRequiresUpgrade(id)) {
          const msg = upgradeMessageForPreset(id);
          if (typeof global.showMessage === 'function') global.showMessage(msg, 'error');
          else alert(msg);
          return;
        }
        active = id;
        setActivePresetId(id, 'card');
        if (typeof onChange === 'function') onChange(id);
      });
    });

    applyPlanLocks(container);

    if (!container.dataset.syncBound) {
      container.dataset.syncBound = '1';
      global.addEventListener?.('cutup:preset-changed', (event) => {
        const id = String(event?.detail?.selectedPresetId || event?.detail?.presetId || '').trim();
        if (!id) return;
        active = id;
        paintActiveCards(id);
      });
    }
  }

  function applyPlanLocks(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-preset-id]').forEach((btn) => {
      const id = btn.getAttribute('data-preset-id');
      const locked = id && presetRequiresUpgrade(id);
      btn.classList.toggle('cutup-preset-card--locked', !!locked);
      btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      if (locked) btn.title = upgradeMessageForPreset(id);
      else btn.removeAttribute('title');
    });
  }

  global.CutupPresetSelector = {
    mount,
    getActivePresetId,
    setActivePresetId,
    applyPlanLocks,
    STORAGE_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
