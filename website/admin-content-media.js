/**
 * Content Studio — Media Library
 */
window.CutupContentMedia = (function () {
  const CS = () => window.CutupContentStudio;
  const {
    esc,
    apiGet,
    apiPost,
    uploadMedia,
    syncMediaLibrary,
    notify,
    humanizeError,
    formatBytes,
    fmtDate
  } = window.CutupContentStudio;

  let items = [];
  let selected = null;
  let selectedIds = new Set();
  let viewMode = 'grid';
  let activeTab = 'all';
  let syncing = false;

  const TABS = [
    { id: 'all', label: 'All files' },
    { id: 'images', label: 'Photos' },
    { id: 'videos', label: 'Video' },
    { id: 'audio', label: 'Audio' },
    { id: 'documents', label: 'Documents' },
    { id: 'blog', label: 'Blog covers' },
    { id: 'logos', label: 'Logos' },
    { id: 'generated', label: 'Generated' },
    { id: 'starred', label: 'Favorites' }
  ];

  function root() {
    return document.getElementById('contentLibraryWorkspace');
  }

  function mediaTypeIcon(type) {
    if (type === 'video') return '▶';
    if (type === 'audio') return '♪';
    if (type === 'document') return '📄';
    return '🖼';
  }

  function filteredItems() {
    const q = document.getElementById('csMediaSearch')?.value?.trim().toLowerCase() || '';
    const type = document.getElementById('csMediaType')?.value || '';
    const typeTab = { images: 'image', videos: 'video', audio: 'audio', documents: 'document' };
    return items.filter((m) => {
      if (activeTab === 'starred' && !m.isStarred) return false;
      if (activeTab !== 'all' && activeTab !== 'starred') {
        const wantType = typeTab[activeTab];
        const folderOk = m.folder === activeTab;
        const typeOk = wantType ? m.mediaType === wantType : false;
        const tagOk = (m.tags || []).includes(activeTab);
        if (!folderOk && !typeOk && !tagOk) return false;
      }
      if (type && m.mediaType !== type) return false;
      if (q && !`${m.originalName} ${m.filename} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }

  function renderTabs() {
    const el = document.getElementById('csMediaTabs');
    if (!el) return;
    el.innerHTML = TABS.map(
      (t) =>
        `<button type="button" class="${activeTab === t.id ? 'is-active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
    ).join('');
    el.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab') || 'all';
        renderTabs();
        renderGrid();
      });
    });
  }

  function renderGrid() {
    const grid = document.getElementById('csMediaGrid');
    if (!grid) return;
    const filtered = filteredItems();
    grid.className = viewMode === 'list' ? 'cs-media-grid cs-list-view' : 'cs-media-grid';
    grid.innerHTML =
      filtered
        .map((m) => {
          const sel =
            (selected && String(selected.id) === String(m.id)) || selectedIds.has(String(m.id))
              ? ' is-selected'
              : '';
          const thumb =
            m.mediaType === 'image'
              ? `<img src="${esc(m.url)}" alt="" loading="lazy">`
              : `<span style="font-size:28px">${mediaTypeIcon(m.mediaType)}</span>`;
          const dim =
            m.width && m.height ? `${m.width}×${m.height}` : formatBytes(m.fileSize);
          return `<article class="cs-media-card${sel}" data-media-id="${esc(m.id)}">
          <div class="cs-media-thumb">${thumb}
            <div class="cs-media-overlay">
              <button type="button" class="btn ghost" data-quick-copy="${esc(m.id)}" title="Copy URL">⎘</button>
              <button type="button" class="btn ghost" data-quick-star="${esc(m.id)}" title="Favorite">${m.isStarred ? '★' : '☆'}</button>
            </div>
          </div>
          <div class="cs-media-meta">
            <strong>${esc(m.originalName)}</strong>
            <div class="cs-media-dim">${esc(m.mediaType)} · ${esc(dim)}${m.usageCount ? ` · used ${m.usageCount}×` : ''}</div>
          </div>
        </article>`;
        })
        .join('') ||
      '<p class="cs-empty">No files in this view. Try syncing the library or upload new media.</p>';

    grid.querySelectorAll('.cs-media-card').forEach((card) => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-quick-copy],[data-quick-star]')) return;
        const id = card.getAttribute('data-media-id');
        if (ev.shiftKey) {
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          renderGrid();
          return;
        }
        selected = items.find((x) => String(x.id) === id) || null;
        renderGrid();
        renderDrawer();
      });
    });
    grid.querySelectorAll('[data-quick-copy]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        copyUrl(btn.getAttribute('data-quick-copy'));
      });
    });
    grid.querySelectorAll('[data-quick-star]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleStar(btn.getAttribute('data-quick-star'));
      });
    });
  }

  async function copyUrl(id) {
    const m = items.find((x) => String(x.id) === String(id));
    if (!m) return;
    const full = `${window.location.origin}${m.url}`;
    try {
      await navigator.clipboard.writeText(full);
      notify('URL copied to clipboard.', 'success', 2800);
    } catch {
      notify('Could not copy URL.', 'error');
    }
  }

  async function toggleStar(id) {
    const m = items.find((x) => String(x.id) === String(id));
    if (!m) return;
    try {
      await apiPost('updateCmsMedia', {
        id: m.id,
        patch: { isStarred: !m.isStarred }
      });
      await fetchMedia();
      selected = items.find((x) => String(x.id) === String(id)) || null;
      renderGrid();
      renderDrawer();
    } catch (e) {
      notify(humanizeError(e), 'error');
    }
  }

  function renderDrawer() {
    const d = document.getElementById('csMediaDrawer');
    if (!d) return;
    if (!selected) {
      d.innerHTML = '<p class="muted">Select a file to preview metadata, copy URL, or edit alt text.</p>';
      return;
    }
    const m = selected;
    const preview =
      m.mediaType === 'image'
        ? `<img src="${esc(m.url)}" alt="" style="max-width:100%;border-radius:10px">`
        : m.mediaType === 'video'
          ? `<video src="${esc(m.url)}" controls style="width:100%;border-radius:8px"></video>`
          : m.mediaType === 'audio'
            ? `<audio src="${esc(m.url)}" controls style="width:100%"></audio>`
            : `<p class="muted">${esc(m.mimeType)}</p>`;
  d.innerHTML = `
      <h3>${esc(m.originalName)}</h3>
      ${preview}
      <dl class="cs-drawer-meta">
        <dt>Type</dt><dd>${esc(m.mediaType)}</dd>
        <dt>Size</dt><dd>${esc(formatBytes(m.fileSize))}</dd>
        <dt>Folder</dt><dd>${esc(m.folder || '—')}</dd>
        <dt>Used</dt><dd>${m.usageCount || 0} places</dd>
        <dt>Uploaded</dt><dd>${esc(fmtDate(m.createdAt))}</dd>
        <dt>By</dt><dd>${esc(m.uploadedBy || '—')}</dd>
      </dl>
      <label>Alt text<input id="csMediaAlt" value="${esc(m.altText || '')}" /></label>
      <label>Caption<textarea id="csMediaCaption" rows="2">${esc(m.caption || '')}</textarea></label>
      <p style="font-size:11px;word-break:break-all"><code>${esc(m.url)}</code></p>
      <div class="cs-toolbar-row" style="margin-top:12px">
        <button type="button" class="btn ghost cs-star-btn${m.isStarred ? ' is-on' : ''}" id="csMediaStar">${m.isStarred ? '★ Favorited' : '☆ Add favorite'}</button>
        <button type="button" class="btn ghost" id="csMediaCopyUrl">Copy URL</button>
        <button type="button" class="btn ghost" id="csMediaSaveMeta">Save</button>
        <button type="button" class="btn ghost" id="csMediaDelete">Delete</button>
      </div>`;
    document.getElementById('csMediaCopyUrl')?.addEventListener('click', () => copyUrl(m.id));
    document.getElementById('csMediaStar')?.addEventListener('click', () => toggleStar(m.id));
    document.getElementById('csMediaSaveMeta')?.addEventListener('click', async () => {
      try {
        await apiPost('updateCmsMedia', {
          id: m.id,
          patch: {
            altText: document.getElementById('csMediaAlt')?.value || '',
            caption: document.getElementById('csMediaCaption')?.value || ''
          }
        });
        await fetchMedia();
        selected = items.find((x) => String(x.id) === String(m.id)) || null;
        renderDrawer();
        notify('Media details saved.', 'success');
      } catch (e) {
        notify(humanizeError(e), 'error');
      }
    });
    document.getElementById('csMediaDelete')?.addEventListener('click', async () => {
      const ok = await CS().confirmAction({
        title: 'Remove from library?',
        message: 'The file may remain on disk. You can re-index it later.',
        confirmLabel: 'Remove',
        danger: true
      });
      if (!ok) return;
      const idToRemove = m.id;
      const prevItems = items.slice();
      items = items.filter((x) => String(x.id) !== String(idToRemove));
      selectedIds.delete(String(idToRemove));
      selected = null;
      renderGrid();
      renderDrawer();
      const count = document.getElementById('csMediaCount');
      if (count) count.textContent = `${items.length} files`;
      try {
        await apiPost('deleteCmsMedia', { id: idToRemove });
        notify('Removed from library.', 'success');
      } catch (e) {
        items = prevItems;
        selected = items.find((x) => String(x.id) === String(idToRemove)) || null;
        renderGrid();
        renderDrawer();
        if (count) count.textContent = `${items.length} files`;
        notify(humanizeError(e), 'error');
      }
    });
  }

  function shellHtml() {
    return `<div class="cs-root cs-media-shell">
      <header class="cs-hero">
        <div>
          <h2>Library</h2>
          <p class="cs-subtitle">Site-wide media — uploads, logos, blog covers, and indexed assets.</p>
        </div>
        <div class="cs-toolbar-row">
          <button type="button" class="btn ghost" id="csMediaSync">Sync library</button>
          <button type="button" class="btn ghost" data-view="grid">Grid</button>
          <button type="button" class="btn ghost" data-view="list">List</button>
        </div>
      </header>
      <div id="csMediaTabs" class="cs-media-tabs"></div>
      <div id="csMediaDrop" class="cs-dropzone">
        <p><strong>Drop files to upload</strong> or <label class="btn ghost" style="cursor:pointer;margin:0">Browse<input type="file" id="csMediaFile" multiple hidden accept="image/*,video/*,audio/*,.pdf"></label></p>
        <p class="muted" style="font-size:12px;margin:8px 0 0">JPEG, PNG, WebP, GIF, SVG, MP4, MP3, PDF — max 50 MB each</p>
      </div>
      <div id="csUploadQueue" class="cs-upload-queue" hidden></div>
      <div class="cs-filter-bar cs-media-toolbar">
        <input id="csMediaSearch" placeholder="Search filename, tags…" style="flex:1;min-width:180px" />
        <select id="csMediaType"><option value="">All types</option>
          <option value="image">Images</option><option value="video">Video</option>
          <option value="audio">Audio</option><option value="document">Documents</option>
        </select>
        <span class="muted" id="csMediaCount" style="font-size:12px"></span>
      </div>
      <div class="cs-media-layout">
        <div id="csMediaGrid" class="cs-media-grid"></div>
        <aside id="csMediaDrawer" class="cs-drawer"><p class="muted">Select a file…</p></aside>
      </div>
    </div>`;
  }

  function renderUploadQueue(entries) {
    const q = document.getElementById('csUploadQueue');
    if (!q) return;
    if (!entries.length) {
      q.hidden = true;
      q.innerHTML = '';
      return;
    }
    q.hidden = false;
    q.innerHTML = entries
      .map(
        (e) => `<div class="cs-upload-item ${e.state}">
        <span style="min-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(e.name)}</span>
        <progress max="100" value="${e.progress}"></progress>
        <span>${e.progress}%</span>
      </div>`
      )
      .join('');
  }

  async function handleFiles(fileList) {
    const files = [...fileList];
    const entries = files.map((f) => ({ name: f.name, progress: 0, state: '' }));
    renderUploadQueue(entries);
    let okCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        await CS().uploadMediaWithProgress(file, (pct) => {
          entries[i].progress = pct;
          entries[i].state = pct >= 100 ? 'is-done' : '';
          renderUploadQueue(entries);
        });
        entries[i].state = 'is-done';
        entries[i].progress = 100;
        okCount++;
        renderUploadQueue(entries);
      } catch (e) {
        entries[i].state = 'is-error';
        renderUploadQueue(entries);
        notify(`${file.name}: ${humanizeError(e)}`, 'error', 7000);
      }
    }
    setTimeout(() => renderUploadQueue([]), 2500);
    if (okCount > 0) {
      try {
        await fetchMedia();
        renderGrid();
        const count = document.getElementById('csMediaCount');
        if (count) count.textContent = `${items.length} files`;
      } catch {
        /* list refresh optional */
      }
      notify(okCount > 1 ? `${okCount} files uploaded.` : 'Upload complete.', 'success');
    }
  }

  async function runSync() {
    if (syncing) return;
    syncing = true;
    const btn = document.getElementById('csMediaSync');
    if (btn) btn.disabled = true;
    notify('Scanning site assets…', 'info', 3000);
    try {
      const res = await syncMediaLibrary();
      await fetchMedia();
      renderGrid();
      renderDrawer();
      const c = document.getElementById('csMediaCount');
      if (c) c.textContent = `${items.length} files`;
      notify(
        `Library synced — ${res.inserted || 0} new, ${res.updated || 0} updated (${res.scanned || 0} scanned).`,
        'success',
        6000
      );
    } catch (e) {
      notify(humanizeError(e, 'Sync failed.'), 'error');
    } finally {
      syncing = false;
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    document.getElementById('csMediaSync')?.addEventListener('click', runSync);
    const drop = document.getElementById('csMediaDrop');
    const input = document.getElementById('csMediaFile');
    input?.addEventListener('change', () => {
      if (input.files?.length) handleFiles(input.files);
      input.value = '';
    });
    drop?.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('is-dragover');
    });
    drop?.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
    drop?.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-dragover');
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    });
    document.getElementById('csMediaSearch')?.addEventListener('input', renderGrid);
    document.getElementById('csMediaType')?.addEventListener('change', renderGrid);
    root()?.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        viewMode = btn.getAttribute('data-view') || 'grid';
        renderGrid();
      });
    });
    renderTabs();
  }

  async function fetchMedia() {
    const data = await apiGet('cmsMedia', { limit: 500 });
    items = data.media || [];
  }

  async function load() {
    const el = root();
    if (!el) return;
    el.innerHTML = '<div class="cs-skeleton"></div>';
    try {
      try {
        await syncMediaLibrary();
      } catch {
        /* sync optional on first load */
      }
      await fetchMedia();
      el.innerHTML = shellHtml();
      bind();
      const c = document.getElementById('csMediaCount');
      if (c) c.textContent = `${items.length} files`;
      renderGrid();
      renderDrawer();
    } catch (e) {
      if (CS().isSetupError?.(e)) {
        CS().renderSetupState(el, {
          missingTables: e.payload?.missingTables,
          onRetry: () => load()
        });
        return;
      }
      el.innerHTML = `<div class="cs-empty"><h3>Could not load library</h3><p>${esc(CS().friendlyApiMessage?.({ message: e.message }) || 'Please try again.')}</p></div>`;
    }
  }

  function destroy() {
    selected = null;
    selectedIds = new Set();
  }

  return { load, destroy };
})();
