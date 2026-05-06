/**
 * Reusable CMS image URL field with preview + media library picker.
 */
window.CutupMediaField = (function () {
  const CS = () => window.CutupContentStudio;
  const esc = (s) => CS().esc(s);

  const PLACEHOLDER = 'Paste image URL or use Media Library';
  let clipboardUrlCache = null;
  let clipboardCheckedAt = 0;

  function fullUrl(url) {
    return window.CutupMediaModal?.fullUrl?.(url) || url;
  }

  function isImageUrl(str) {
    const s = String(str || '').trim();
    if (!s) return false;
    if (/^https?:\/\/.+/i.test(s)) return /\.(jpe?g|png|gif|webp|svg|avif)(\?|$)/i.test(s) || /\/uploads\//i.test(s);
    return /^\/[^\s]+\.(jpe?g|png|gif|webp|svg|avif)(\?|$)/i.test(s);
  }

  function fileNameFromUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url, window.location.origin);
      const base = u.pathname.split('/').pop() || '';
      return decodeURIComponent(base.split('?')[0]);
    } catch {
      const parts = String(url).split('/');
      return parts[parts.length - 1]?.split('?')[0] || '';
    }
  }

  async function refreshClipboardHint() {
    const now = Date.now();
    if (now - clipboardCheckedAt < 800) return clipboardUrlCache;
    clipboardCheckedAt = now;
    clipboardUrlCache = null;
    if (!navigator.clipboard?.readText) return null;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (isImageUrl(text)) clipboardUrlCache = text;
    } catch {
      /* permission denied */
    }
    return clipboardUrlCache;
  }

  function previewHtml(url) {
    if (!url) {
      return `<div class="cms-media-preview cms-media-preview--empty" aria-hidden="true">
        <span>No image selected</span>
      </div>`;
    }
    const name = fileNameFromUrl(url);
    const src = fullUrl(url);
    return `<div class="cms-media-preview">
      <img src="${esc(src)}" alt="" loading="lazy" />
      <div class="cms-media-preview-meta">
        <span class="cms-media-preview-name">${esc(name || 'Image')}</span>
        <button type="button" class="btn ghost cms-media-remove" data-media-remove>Remove</button>
      </div>
    </div>`;
  }

  function updateActionLabel(wrap, input) {
    const btn = wrap.querySelector('[data-media-action]');
    if (!btn) return;
    const hasValue = Boolean(input?.value?.trim());
    const clip = clipboardUrlCache && isImageUrl(clipboardUrlCache);
    btn.textContent = hasValue || clip ? 'Insert' : 'Upload';
    btn.dataset.mode = hasValue || clip ? 'insert' : 'upload';
  }

  function bindPreview(wrap, input, onChange) {
    const previewHost = wrap.querySelector('[data-media-preview-host]');
    const renderPreview = () => {
      if (previewHost) previewHost.innerHTML = previewHtml(input.value.trim());
      previewHost?.querySelector('[data-media-remove]')?.addEventListener('click', () => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        onChange?.('');
        renderPreview();
        updateActionLabel(wrap, input);
      });
    };
    renderPreview();
    return renderPreview;
  }

  /**
   * @param {{ container?: Element|string, value?: string, onChange?: (url: string) => void, label?: string, accept?: string, inputId?: string, dataBf?: string, dataI?: string|number }} opts
   */
  function renderMediaField(opts) {
    const host =
      typeof opts.container === 'string'
        ? document.querySelector(opts.container)
        : opts.container;
    if (!host) return null;

    const accept = opts.accept || 'image/*';
    const inputId = opts.inputId || '';
    const idAttr = inputId ? ` id="${esc(inputId)}"` : '';

    host.classList.add('cms-media-field-root');
    host.innerHTML = `
      <div class="cms-media-field">
        <div class="cms-media-field-row">
          <input type="url"${idAttr} class="cms-media-field-input" placeholder="${esc(PLACEHOLDER)}" value="${esc(opts.value || '')}"
            ${opts.dataBf ? ` data-bf="${esc(opts.dataBf)}"` : ''}${opts.dataI != null ? ` data-i="${esc(String(opts.dataI))}"` : ''} />
          <button type="button" class="btn ghost cms-media-field-btn" data-media-action>Upload</button>
        </div>
        <div data-media-preview-host></div>
      </div>`;

    const wrap = host.querySelector('.cms-media-field');
    const input = host.querySelector('.cms-media-field-input');
    const actionBtn = host.querySelector('[data-media-action]');
    const renderPreview = bindPreview(wrap, input, opts.onChange);

    const applyValue = (url, silent) => {
      input.value = url || '';
      if (!silent) input.dispatchEvent(new Event('input', { bubbles: true }));
      renderPreview();
      updateActionLabel(wrap, input);
      opts.onChange?.(input.value.trim());
    };

    input.addEventListener('input', () => {
      renderPreview();
      updateActionLabel(wrap, input);
      opts.onChange?.(input.value.trim());
    });

    actionBtn?.addEventListener('click', async () => {
      const mode = actionBtn.dataset.mode || 'upload';
      if (mode === 'insert') {
        const clip = clipboardUrlCache || (await refreshClipboardHint());
        const toInsert = clip || input.value.trim();
        if (toInsert) {
          applyValue(toInsert);
          CS().notify?.('Image inserted', 'success', 2800);
        }
        return;
      }
      window.CutupMediaModal?.open({
        accept,
        title: 'Choose image',
        onInsert: (item) => {
          if (item?.url) applyValue(item.url);
        }
      });
    });

    void refreshClipboardHint().then(() => updateActionLabel(wrap, input));
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          void refreshClipboardHint().then(() => updateActionLabel(wrap, input));
        }
      },
      { passive: true }
    );

    host._cmsMediaApply = applyValue;
    host._cmsMediaGetInput = () => input;
    return { input, applyValue, host };
  }

  function setValue(hostOrSelector, url) {
    const host =
      typeof hostOrSelector === 'string'
        ? document.querySelector(hostOrSelector)
        : hostOrSelector;
    if (!host) return;
    if (host._cmsMediaApply) {
      host._cmsMediaApply(url || '', true);
      return;
    }
    const input = host.querySelector?.('.cms-media-field-input') || document.getElementById('cmsEdFeatured');
    if (input) {
      input.value = url || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function hostMarkup({ label, dataBf, dataI, value }) {
    return `<label class="cms-media-field-label">${esc(label)}
      <div class="cms-media-field-mount" data-cms-media-field data-bf="${esc(dataBf)}" data-i="${esc(String(dataI))}" data-value="${esc(value || '')}"></div>
    </label>`;
  }

  function hydrate(root, onDirty) {
    const scope = root || document;
    scope.querySelectorAll('[data-cms-media-field]:not([data-cms-media-mounted])').forEach((el) => {
      el.dataset.cmsMediaMounted = '1';
      renderMediaField({
        container: el,
        value: el.getAttribute('data-value') || '',
        accept: 'image/*',
        dataBf: el.getAttribute('data-bf') || '',
        dataI: el.getAttribute('data-i'),
        onChange: () => onDirty?.()
      });
    });
  }

  function galleryToolbarHtml(i) {
    return `<div class="cms-media-gallery-tools">
      <button type="button" class="btn ghost" data-gallery-pick="${i}">Add from library</button>
    </div>`;
  }

  function logosToolbarHtml(i) {
    return `<div class="cms-media-gallery-tools">
      <button type="button" class="btn ghost" data-logos-pick="${i}">Add logo from library</button>
    </div>`;
  }

  function bindGalleryPickers(host, onDirty) {
    host.querySelectorAll('[data-gallery-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-gallery-pick'));
        window.CutupMediaModal?.open({
          accept: 'image/*',
          onInsert: (item) => {
            if (!item?.url) return;
            const card = host.querySelector(`.cs-block[data-block-index="${i}"]`);
            const ta = card?.querySelector('[data-bf="imagesText"]');
            if (!ta) return;
            const line = `${item.url} | | `;
            ta.value = ta.value.trim() ? `${ta.value.trim()}\n${line}` : line;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            onDirty?.();
            CS().notify?.('Image inserted', 'success', 2800);
          }
        });
      });
    });
    host.querySelectorAll('[data-logos-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-logos-pick'));
        window.CutupMediaModal?.open({
          accept: 'image/*',
          onInsert: (item) => {
            if (!item?.url) return;
            const card = host.querySelector(`.cs-block[data-block-index="${i}"]`);
            const ta = card?.querySelector('[data-bf="itemsText"]');
            if (!ta) return;
            const line = `| ${item.url}`;
            ta.value = ta.value.trim() ? `${ta.value.trim()}\n${line}` : line;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            onDirty?.();
            CS().notify?.('Image inserted', 'success', 2800);
          }
        });
      });
    });
  }

  return {
    renderMediaField,
    setValue,
    hostMarkup,
    hydrate,
    galleryToolbarHtml,
    logosToolbarHtml,
    bindGalleryPickers,
    isImageUrl,
    fullUrl
  };
})();
