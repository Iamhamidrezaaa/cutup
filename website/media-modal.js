/**
 * CMS media picker modal — uses existing Content Studio media APIs.
 */
window.CutupMediaModal = (function () {
  const CS = () => window.CutupContentStudio;
  const esc = (s) => CS().esc(s);
  const PAGE_SIZE = 48;

  let openCount = 0;
  let activeTarget = null;

  function fullUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
  }

  function acceptImagesOnly(accept) {
    return !accept || accept === 'image/*' || String(accept).includes('image');
  }

  function filterByAccept(items, accept) {
    if (!acceptImagesOnly(accept)) return items;
    return items.filter((m) => m.mediaType === 'image');
  }

  function notify(msg, type) {
    CS().notify?.(msg, type || 'info');
  }

  function skeletonTiles(n) {
    return Array.from({ length: n })
      .map(() => '<div class="cms-mp-skeleton" aria-hidden="true"></div>')
      .join('');
  }

  /**
   * @param {{ accept?: string, title?: string, onInsert?: (item: { url, id, originalName }) => void, onCancel?: () => void }} opts
   */
  function open(opts = {}) {
    if (openCount > 0) return;
    const accept = opts.accept || 'image/*';
    const title = opts.title || 'Media Library';
    activeTarget = opts;

    const backdrop = document.createElement('div');
    backdrop.className = 'cs-media-picker-backdrop cms-mp-backdrop';
    backdrop.innerHTML = `<div class="cs-media-picker cms-mp-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="cms-mp-header">
        <h3>${esc(title)}</h3>
        <button type="button" class="btn ghost" data-mp-close aria-label="Close">✕</button>
      </header>
      <div class="cms-mp-drop" data-mp-drop>
        <p><strong>Drop images here</strong> or <label class="btn ghost" style="cursor:pointer;margin:0">Browse
          <input type="file" data-mp-file hidden accept="${esc(accept)}"></label></p>
      </div>
      <div class="cms-mp-toolbar">
        <input type="search" placeholder="Search by filename…" data-mp-search autocomplete="off" />
        <span class="muted cms-mp-count" data-mp-count></span>
      </div>
      <div class="cms-mp-body">
        <div class="cms-mp-grid-wrap">
          <div class="cs-media-picker-grid cms-mp-grid" data-mp-grid>${skeletonTiles(12)}</div>
          <button type="button" class="btn ghost cms-mp-more" data-mp-more hidden>Load more</button>
        </div>
        <aside class="cms-mp-detail" data-mp-detail>
          <p class="muted">Select an image to preview details.</p>
        </aside>
      </div>
      <footer class="cms-mp-footer">
        <button type="button" class="btn ghost" data-mp-cancel>Cancel</button>
        <button type="button" class="btn" data-mp-insert disabled>Insert image</button>
      </footer>
    </div>`;
    document.body.appendChild(backdrop);
    document.body.classList.add('cms-mp-open');
    openCount = 1;

    let items = [];
    let filtered = [];
    let selected = null;
    let visibleCount = PAGE_SIZE;
    let loading = true;
    let uploading = false;
    let keyHandler = null;

    const grid = backdrop.querySelector('[data-mp-grid]');
    const detail = backdrop.querySelector('[data-mp-detail]');
    const insertBtn = backdrop.querySelector('[data-mp-insert]');
    const moreBtn = backdrop.querySelector('[data-mp-more]');
    const countEl = backdrop.querySelector('[data-mp-count]');
    const searchEl = backdrop.querySelector('[data-mp-search]');
    const drop = backdrop.querySelector('[data-mp-drop]');
    const fileInput = backdrop.querySelector('[data-mp-file]');

    function close(result) {
      if (!openCount) return;
      openCount = 0;
      activeTarget = null;
      document.body.classList.remove('cms-mp-open');
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      backdrop.remove();
      if (result) opts.onInsert?.(result);
      else opts.onCancel?.();
    }

    function applyFilter() {
      const q = (searchEl?.value || '').trim().toLowerCase();
      filtered = filterByAccept(items, accept).filter((m) => {
        if (!q) return true;
        return `${m.originalName || ''} ${m.filename || ''} ${(m.tags || []).join(' ')}`
          .toLowerCase()
          .includes(q);
      });
      if (selected && !filtered.some((x) => String(x.id) === String(selected.id))) {
        selected = null;
        insertBtn.disabled = true;
      }
    }

    function renderDetail() {
      if (!detail) return;
      if (!selected) {
        detail.innerHTML = '<p class="muted">Select an image to preview details.</p>';
        return;
      }
      const m = selected;
      const dim = m.width && m.height ? `${m.width} × ${m.height}` : '—';
      const uploaded = CS().fmtDate?.(m.createdAt) || m.createdAt || '—';
      const preview =
        m.mediaType === 'image'
          ? `<img src="${esc(m.url)}" alt="" class="cms-mp-detail-img">`
          : `<p class="muted">${esc(m.mediaType)}</p>`;
      detail.innerHTML = `
        ${preview}
        <h4 class="cms-mp-detail-name">${esc(m.originalName || m.filename)}</h4>
        <dl class="cms-mp-detail-meta">
          <dt>Dimensions</dt><dd>${esc(dim)}</dd>
          <dt>Uploaded</dt><dd>${esc(uploaded)}</dd>
          <dt>Size</dt><dd>${esc(CS().formatBytes?.(m.fileSize) || '')}</dd>
        </dl>
        <p class="cms-mp-detail-url"><code>${esc(fullUrl(m.url))}</code></p>
        <div class="cms-mp-detail-actions">
          <button type="button" class="btn ghost" data-mp-copy>Copy URL</button>
          <button type="button" class="btn ghost" data-mp-delete>Delete</button>
        </div>`;
      detail.querySelector('[data-mp-copy]')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(fullUrl(m.url));
          notify('URL copied to clipboard.', 'success');
        } catch {
          notify('Could not copy URL.', 'error');
        }
      });
      detail.querySelector('[data-mp-delete]')?.addEventListener('click', async () => {
        const ok = await CS().confirmAction?.({
          title: 'Remove from library?',
          message: 'The file may remain on disk. You can re-index it later.',
          confirmLabel: 'Remove',
          danger: true
        });
        if (!ok) return;
        try {
          await CS().apiPost('deleteCmsMedia', { id: m.id });
          items = items.filter((x) => String(x.id) !== String(m.id));
          selected = null;
          insertBtn.disabled = true;
          applyFilter();
          renderGrid();
          renderDetail();
          notify('Removed from library.', 'success');
        } catch (e) {
          notify(CS().humanizeError?.(e) || 'Delete failed.', 'error');
        }
      });
    }

    function renderGrid() {
      if (!grid) return;
      if (loading) {
        grid.innerHTML = skeletonTiles(12);
        return;
      }
      applyFilter();
      const slice = filtered.slice(0, visibleCount);
      if (countEl) countEl.textContent = `${filtered.length} file${filtered.length === 1 ? '' : 's'}`;
      if (moreBtn) moreBtn.hidden = visibleCount >= filtered.length;
      if (!slice.length) {
        grid.innerHTML =
          '<p class="muted cms-mp-empty">No images found. Upload below or open Library to sync.</p>';
        return;
      }
      grid.innerHTML = slice
        .map((m) => {
          const sel = selected && String(selected.id) === String(m.id) ? ' is-selected' : '';
          const thumb =
            m.mediaType === 'image'
              ? `<img src="${esc(m.url)}" alt="" loading="lazy">`
              : `<span>${esc(m.mediaType)}</span>`;
          const dim =
            m.width && m.height ? `${m.width}×${m.height}` : CS().formatBytes?.(m.fileSize) || '';
          return `<button type="button" class="cs-media-picker-tile cms-mp-tile${sel}" data-id="${esc(m.id)}">
            ${thumb}
            <span class="cms-mp-tile-name">${esc(m.originalName || m.filename)}</span>
            <span class="cms-mp-tile-meta muted">${esc(dim)}</span>
          </button>`;
        })
        .join('');
      grid.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          selected = items.find((x) => String(x.id) === String(id)) || null;
          insertBtn.disabled = !selected;
          renderGrid();
          renderDetail();
        });
        btn.addEventListener('dblclick', () => {
          const id = btn.getAttribute('data-id');
          selected = items.find((x) => String(x.id) === String(id)) || null;
          if (selected) confirmInsert();
        });
      });
    }

    async function loadMedia() {
      loading = true;
      renderGrid();
      try {
        const data = await CS().apiGet('cmsMedia', { limit: 500 });
        items = data.media || [];
      } catch {
        items = [];
        if (grid) grid.innerHTML = '<p class="muted">Could not load library.</p>';
      } finally {
        loading = false;
        visibleCount = PAGE_SIZE;
        renderGrid();
      }
    }

    async function handleUpload(fileList) {
      const files = [...fileList].filter(Boolean);
      if (!files.length || uploading) return;
      uploading = true;
      drop?.classList.add('is-uploading');
      let ok = 0;
      for (const file of files) {
        try {
          await CS().uploadMediaWithProgress(file, () => {});
          ok++;
        } catch (e) {
          notify(`${file.name}: ${CS().humanizeError?.(e) || 'Upload failed.'}`, 'error', 7000);
        }
      }
      uploading = false;
      drop?.classList.remove('is-uploading');
      if (ok > 0) {
        await loadMedia();
        const last = items[items.length - 1];
        if (last && acceptImagesOnly(accept) && last.mediaType === 'image') {
          selected = last;
          insertBtn.disabled = false;
          renderGrid();
          renderDetail();
        }
        notify(ok > 1 ? `${ok} files uploaded.` : 'Upload complete.', 'success');
      }
    }

    function confirmInsert() {
      if (!selected) return;
      const url = fullUrl(selected.url);
      close({ url, id: selected.id, originalName: selected.originalName || selected.filename });
      notify('Image inserted', 'success', 2800);
    }

    backdrop.querySelector('[data-mp-close]')?.addEventListener('click', () => close(null));
    backdrop.querySelector('[data-mp-cancel]')?.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    insertBtn?.addEventListener('click', confirmInsert);
    searchEl?.addEventListener('input', () => {
      visibleCount = PAGE_SIZE;
      renderGrid();
    });
    moreBtn?.addEventListener('click', () => {
      visibleCount += PAGE_SIZE;
      renderGrid();
    });
    fileInput?.addEventListener('change', () => {
      if (fileInput.files?.length) handleUpload(fileInput.files);
      fileInput.value = '';
    });
    drop?.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('is-dragover');
    });
    drop?.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
    drop?.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-dragover');
      if (e.dataTransfer?.files?.length) handleUpload(e.dataTransfer.files);
    });

    keyHandler = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close(null);
      } else if (ev.key === 'Enter' && selected && !ev.target.matches('textarea,input[type=search]')) {
        ev.preventDefault();
        confirmInsert();
      }
    };
    document.addEventListener('keydown', keyHandler);

    setTimeout(() => searchEl?.focus(), 50);
    void loadMedia();
  }

  return { open, fullUrl };
})();
