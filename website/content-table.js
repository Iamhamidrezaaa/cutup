/**
 * Unified CMS content table — WordPress-style list manager.
 */
window.CutupContentTable = (function () {
  const CS = () => window.CutupContentStudio;
  const esc = (s) => CS().esc(s);
  const TRASH = () => CS().TRASH_ICON_SRC;

  const STATUS_TABS = [
    { id: 'all', label: 'All' },
    { id: 'published', label: 'Published' },
    { id: 'draft', label: 'Draft' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'archived', label: 'Archived' },
    { id: 'trash', label: 'Trash' }
  ];

  const PAGE_SIZE = 20;

  function isTrashStatus(status) {
    const s = String(status || '').toLowerCase();
    return s === 'trash' || s === 'deleted';
  }

  let instance = null;

  function destroy() {
    if (instance?.container) instance.container.innerHTML = '';
    instance = null;
  }

  /**
   * @param {{ container: HTMLElement, type: 'pages'|'posts', onEdit?: Function, onAdd?: Function }} opts
   */
  function renderContentTable(opts) {
    destroy();
    const container = opts.container;
    const type = opts.type === 'pages' ? 'pages' : 'posts';
    const cfg = window.CutupContentConfig.get(type);
    if (!container || !cfg) return null;

    instance = {
      container,
      type,
      cfg,
      items: [],
      filtered: [],
      statusTab: 'all',
      search: '',
      page: 1,
      selected: new Set(),
      quickEditId: null,
      onEdit: opts.onEdit,
      onAdd: opts.onAdd
    };

    container.innerHTML = shellHtml(cfg);
    bindShell();
    refresh();
    return instance;
  }

  function shellHtml(cfg) {
    const tabs = STATUS_TABS.map(
      (t) =>
        `<button type="button" class="cms-table-tab" data-status-tab="${t.id}">${esc(t.label)} <span class="cms-table-tab-count" data-count-for="${t.id}">0</span></button>`
    ).join('');
    return `<div class="cms-table-root" data-cms-type="${esc(cfg.key)}">
      <header class="cms-table-head">
        <div>
          <h2 class="cms-table-title">${esc(cfg.labelPlural)}</h2>
          <p class="cms-table-sub">Manage ${esc(cfg.labelPlural.toLowerCase())} — same workflow as WordPress.</p>
        </div>
        <button type="button" class="btn cms-table-add" data-action="add">${esc('Add ' + cfg.label)}</button>
      </header>
      <nav class="cms-table-status-nav" role="tablist" aria-label="Filter by status">${tabs}</nav>
      <div class="cms-table-toolbar">
        <input type="search" class="cms-table-search" placeholder="Search title or slug…" aria-label="Search" />
        <select class="cms-table-bulk" aria-label="Bulk actions" disabled>
          <option value="">Bulk actions</option>
          <option value="publish">Publish</option>
          <option value="draft">Move to draft</option>
          <option value="archive">Archive</option>
          <option value="trash">Move to trash</option>
          <option value="restore">Restore</option>
          <option value="purge">Delete permanently</option>
        </select>
        <button type="button" class="btn ghost cms-table-bulk-apply" disabled>Apply</button>
        <span class="cms-table-result-count muted"></span>
        <span class="cms-table-pagination muted"></span>
      </div>
      <div class="cms-table-wrap table-wrap">
        <table class="cms-table">
          <thead>
            <tr>
              <th class="cms-col-check"><input type="checkbox" data-select-all aria-label="Select all" /></th>
              <th class="cms-col-thumb">Thumb</th>
              <th class="cms-col-title">Title</th>
              <th class="cms-col-status">Status</th>
              <th class="cms-col-author">Author</th>
              <th class="cms-col-cat">${esc(cfg.categoryLabel || 'Category')}</th>
              <th class="cms-col-tags">Tags</th>
              <th class="cms-col-seo">SEO</th>
              <th class="cms-col-date">Updated</th>
            </tr>
          </thead>
          <tbody class="cms-table-body"></tbody>
        </table>
      </div>
      <div class="cms-table-foot">
        <button type="button" class="btn ghost cms-table-prev" disabled>← Previous</button>
        <button type="button" class="btn ghost cms-table-next" disabled>Next →</button>
      </div>`;
  }

  function skeletonRowsHtml(n) {
    return Array.from({ length: n })
      .map(
        () => `<tr class="cms-table-row cms-table-row--skeleton" aria-hidden="true">
          <td><span class="cms-skeleton-bar" style="width:16px;height:16px;border-radius:4px"></span></td>
          <td><span class="cms-skeleton-thumb"></span></td>
          <td colspan="7"><span class="cms-skeleton-bar cms-skeleton-bar--title"></span><span class="cms-skeleton-bar cms-skeleton-bar--slug"></span></td>
        </tr>`
      )
      .join('');
  }

  function emptyStateHtml(inTrash) {
    const title = inTrash ? 'Trash is empty' : 'No content yet';
    const desc = inTrash
      ? 'Trashed items will appear here.'
      : 'Create your first entry or adjust filters to see results.';
    const cta = inTrash
      ? ''
      : `<button type="button" class="btn cms-table-empty-cta" data-action="add">Add ${esc(instance.cfg.label)}</button>`;
    return `<tr><td colspan="9" class="cms-table-empty-state">
      <div class="cms-table-empty-card">
        <h3>${esc(title)}</h3>
        <p>${esc(desc)}</p>
        ${cta}
      </div>
    </td></tr>`;
  }

  function rowActionBtn(act, id, label, extraClass) {
    return `<button type="button" class="cms-row-action${extraClass ? ` ${extraClass}` : ''}" data-act="${esc(act)}" data-id="${esc(id)}">${esc(label)}</button>`;
  }

  function bindShell() {
    const root = instance.container.querySelector('.cms-table-root');
    if (!root) return;

    root.querySelector('[data-action="add"]')?.addEventListener('click', () => instance.onAdd?.());

    root.querySelector('.cms-table-search')?.addEventListener('input', (ev) => {
      instance.search = ev.target.value.trim().toLowerCase();
      instance.page = 1;
      applyFilters();
      paintRows();
    });

    root.querySelectorAll('[data-status-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        instance.statusTab = btn.getAttribute('data-status-tab') || 'all';
        instance.page = 1;
        instance.selected.clear();
        root.querySelectorAll('.cms-table-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
        refresh();
      });
    });

    root.querySelector('[data-select-all]')?.addEventListener('change', (ev) => {
      const checked = ev.target.checked;
      pageSlice().forEach((row) => {
        if (checked) instance.selected.add(row.id);
        else instance.selected.delete(row.id);
      });
      paintRows();
      syncBulkUi();
    });

    root.querySelector('.cms-table-bulk-apply')?.addEventListener('click', () => runBulkAction());
    root.querySelector('.cms-table-bulk')?.addEventListener('change', syncBulkUi);

    root.querySelector('.cms-table-prev')?.addEventListener('click', () => {
      if (instance.page > 1) {
        instance.page -= 1;
        paintRows();
      }
    });
    root.querySelector('.cms-table-next')?.addEventListener('click', () => {
      const max = totalPages();
      if (instance.page < max) {
        instance.page += 1;
        paintRows();
      }
    });

    const allTab = root.querySelector('[data-status-tab="all"]');
    allTab?.classList.add('is-active');
  }

  async function refresh() {
    const root = instance.container.querySelector('.cms-table-root');
    if (!root) return;
    const body = root.querySelector('.cms-table-body');
    if (body) body.innerHTML = skeletonRowsHtml(6);
    try {
      const trash = instance.statusTab === 'trash';
      instance.items = await instance.cfg.fetchItems({ trash });
      applyFilters();
      updateTabCounts();
      paintRows();
    } catch (e) {
      if (CS().isSetupError?.(e)) {
        CS().renderSetupState(instance.container, {
          missingTables: e.payload?.missingTables,
          onRetry: () => refresh()
        });
        return;
      }
      if (body) {
        body.innerHTML = `<tr><td colspan="9" class="cms-table-empty">${esc(CS().humanizeError(e))}</td></tr>`;
      }
    }
  }

  function applyFilters() {
    const q = instance.search;
    const tab = instance.statusTab;
    instance.filtered = instance.items.filter((row) => {
      if (tab === 'trash') return isTrashStatus(row.status);
      if (tab !== 'all' && row.status !== tab) return false;
      if (tab === 'all' && isTrashStatus(row.status)) return false;
      if (q && !`${row.title} ${row.slug}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function updateTabCounts() {
    const root = instance.container.querySelector('.cms-table-root');
    if (!root) return;
    const all = instance.items.filter((r) => !isTrashStatus(r.status));
    const counts = {
      all: all.length,
      published: all.filter((r) => r.status === 'published').length,
      draft: all.filter((r) => r.status === 'draft').length,
      scheduled: all.filter((r) => r.status === 'scheduled').length,
      archived: all.filter((r) => r.status === 'archived').length,
      trash: instance.items.filter((r) => isTrashStatus(r.status)).length
    };
    if (instance.statusTab === 'trash') {
      counts.trash = instance.filtered.length;
    }
    root.querySelectorAll('[data-count-for]').forEach((el) => {
      const k = el.getAttribute('data-count-for');
      el.textContent = String(counts[k] ?? 0);
    });
    const rc = root.querySelector('.cms-table-result-count');
    if (rc) rc.textContent = `${instance.filtered.length} item${instance.filtered.length === 1 ? '' : 's'}`;
  }

  function totalPages() {
    return Math.max(1, Math.ceil(instance.filtered.length / PAGE_SIZE));
  }

  function pageSlice() {
    const start = (instance.page - 1) * PAGE_SIZE;
    return instance.filtered.slice(start, start + PAGE_SIZE);
  }

  function paintRows() {
    const root = instance.container.querySelector('.cms-table-root');
    const body = root?.querySelector('.cms-table-body');
    if (!body) return;
    const rows = pageSlice();
    const inTrash = instance.statusTab === 'trash';
    const superAd = Boolean(CS().isSuperAdmin?.());

    body.innerHTML =
      rows
        .map((row) => {
          const checked = instance.selected.has(row.id) ? ' checked' : '';
          const thumb = row.thumbnailUrl
            ? `<img src="${esc(row.thumbnailUrl)}" alt="" loading="lazy" width="40" height="28">`
            : `<span class="cms-thumb-fallback">${esc((row.title || '?')[0])}</span>`;
          const protectedBadge = row.isProtected
            ? '<span class="cs-badge cs-badge--protected">Protected</span>'
            : row.isHomepage
              ? '<span class="cs-badge cs-badge--home">Home</span>'
              : '';
          const rowActions = inTrash
            ? `<span class="cms-row-actions">
                ${rowActionBtn('restore', row.id, 'Restore', 'cms-row-action--primary')}
                ${superAd ? rowActionBtn('purge', row.id, 'Delete', 'cms-row-action--danger') : ''}
              </span>`
            : `<span class="cms-row-actions">
                ${rowActionBtn('edit', row.id, 'Edit', 'cms-row-action--primary')}
                ${rowActionBtn('quick', row.id, 'Quick Edit')}
                ${rowActionBtn('preview', row.id, 'Preview')}
                ${rowActionBtn('dup', row.id, 'Duplicate')}
                ${row.isProtected ? '' : rowActionBtn('trash', row.id, 'Trash', 'cms-row-action--danger')}
              </span>`;
          const quickOpen = instance.quickEditId === row.id;
          return `<tr class="cms-table-row" data-row-id="${esc(row.id)}">
            <td><input type="checkbox" data-row-select="${esc(row.id)}"${checked}${row.isProtected && inTrash ? ' disabled' : ''}></td>
            <td class="cms-col-thumb">${thumb}</td>
            <td class="cms-col-title">
              <div class="cms-title-cell">
                <div class="cms-title-row">
                  <a href="#" class="cms-title-link" data-act="edit" data-id="${esc(row.id)}">${esc(row.title)}</a>
                  ${protectedBadge}
                </div>
                <div class="cms-slug-line muted">/${esc(row.slug)}</div>
                ${rowActions}
              </div>
            </td>
            <td>${CS().statusBadge(row.status)}</td>
            <td class="cms-col-author muted">${esc(row.author)}</td>
            <td class="cms-col-cat muted">${esc(row.category)}</td>
            <td class="cms-col-tags muted" title="${esc(row.tagsLabel)}">${esc(row.tagsLabel)}</td>
            <td><span class="cms-seo-score">${row.seoScore}%</span></td>
            <td class="cms-col-date muted">${esc(CS().fmtDate(row.updatedAt))}</td>
          </tr>
          ${quickOpen ? quickEditRowHtml(row) : ''}`;
        })
        .join('') ||
      emptyStateHtml(inTrash);

    body.querySelectorAll('[data-row-select]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-row-select');
        if (cb.checked) instance.selected.add(id);
        else instance.selected.delete(id);
        syncBulkUi();
      });
    });

    body.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');
        handleRowAction(act, id);
      });
    });
    body.querySelector('.cms-table-empty-cta')?.addEventListener('click', () => instance.onAdd?.());

    const pag = root.querySelector('.cms-table-pagination');
    if (pag) pag.textContent = `Page ${instance.page} of ${totalPages()}`;
    root.querySelector('.cms-table-prev').disabled = instance.page <= 1;
    root.querySelector('.cms-table-next').disabled = instance.page >= totalPages();
    updateTabCounts();
    syncBulkUi();
  }

  function quickEditRowHtml(row) {
    const cfg = instance.cfg;
    const stOpts = (cfg.statusOptions || [])
      .map((s) => `<option value="${s}"${row.status === s ? ' selected' : ''}>${esc(s)}</option>`)
      .join('');
    let catField = '';
    if (cfg.categoryOptions) {
      catField = `<label>${esc(cfg.categoryLabel)}<select data-qe="category">${cfg.categoryOptions
        .map((c) => `<option value="${c}"${row.category === c ? ' selected' : ''}>${esc(c)}</option>`)
        .join('')}</select></label>`;
    } else {
      catField = `<label>${esc(cfg.categoryLabel)}<input data-qe="category" value="${esc(row.category === '—' ? '' : row.category)}" /></label>`;
    }
    const tagsField =
      instance.type === 'posts'
        ? `<label>Tags<input data-qe="tags" value="${esc((row.tags || []).join(', '))}" placeholder="comma separated" /></label>`
        : '';
    return `<tr class="cms-quick-edit-row" data-quick-for="${esc(row.id)}">
      <td colspan="9">
        <form class="cms-quick-edit-form" data-qe-form="${esc(row.id)}">
          <div class="cms-quick-edit-grid">
            <label>Title<input data-qe="title" value="${esc(row.title)}" required /></label>
            <label>Slug<input data-qe="slug" value="${esc(row.slug)}" /></label>
            <label>Status<select data-qe="status">${stOpts}</select></label>
            ${catField}
            ${tagsField}
          </div>
          <div class="cms-quick-edit-actions">
            <button type="submit" class="btn">Update</button>
            <button type="button" class="btn ghost" data-qe-cancel="${esc(row.id)}">Cancel</button>
          </div>
        </form>
      </td>
    </tr>`;
  }

  function bindQuickEdit(rowId) {
    const form = instance.container.querySelector(`[data-qe-form="${rowId}"]`);
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const row = instance.items.find((r) => r.id === rowId);
      if (!row) return;
      const title = form.querySelector('[data-qe="title"]')?.value?.trim();
      const slug = form.querySelector('[data-qe="slug"]')?.value?.trim();
      const status = form.querySelector('[data-qe="status"]')?.value;
      const category = form.querySelector('[data-qe="category"]')?.value?.trim();
      const tagsRaw = form.querySelector('[data-qe="tags"]')?.value || '';
      try {
        const raw = { ...row.raw, title, slug, status };
        if (instance.type === 'pages') raw.template = category || raw.template;
        else {
          raw.category = category;
          raw.tags = tagsRaw
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        }
        await instance.cfg.save(raw, false);
        instance.quickEditId = null;
        CS().notify('Updated.', 'success');
        await refresh();
      } catch (e) {
        CS().notify(CS().humanizeError(e), 'error');
      }
    });
    form.querySelector(`[data-qe-cancel="${rowId}"]`)?.addEventListener('click', () => {
      instance.quickEditId = null;
      paintRows();
    });
  }

  async function handleRowAction(act, id) {
    const row = instance.items.find((r) => String(r.id) === String(id));
    if (!row && act !== 'edit') return;

    if (act === 'edit') {
      instance.onEdit?.(row?.raw || { id });
      return;
    }
    if (act === 'quick') {
      instance.quickEditId = instance.quickEditId === id ? null : id;
      paintRows();
      if (instance.quickEditId) bindQuickEdit(id);
      return;
    }
    if (act === 'preview') {
      const url = instance.cfg.previewUrl(row);
      if (url) window.open(url, '_blank');
      return;
    }
    if (act === 'dup') {
      try {
        const newId = await instance.cfg.duplicate(id);
        CS().notify('Duplicated.', 'success');
        await refresh();
        const item = await instance.cfg.fetchOne(newId);
        if (item) instance.onEdit?.(item);
      } catch (e) {
        CS().notify(CS().humanizeError(e), 'error');
      }
      return;
    }
    if (act === 'trash') {
      if (row.isProtected) {
        CS().notify('Protected content cannot be trashed.', 'warn');
        return;
      }
      const ok = await CS().confirmAction({
        title: 'Move to trash?',
        message: `"${row.title}" will be hidden. You can restore it from Trash.`,
        confirmLabel: 'Move to trash',
        danger: true
      });
      if (!ok) return;
      try {
        await instance.cfg.softDelete(id);
        CS().notify('Moved to trash.', 'success');
        await refresh();
      } catch (e) {
        CS().notify(CS().humanizeError(e), 'error');
      }
      return;
    }
    if (act === 'restore') {
      try {
        await instance.cfg.restore(id);
        CS().notify('Restored.', 'success');
        await refresh();
      } catch (e) {
        CS().notify(CS().humanizeError(e), 'error');
      }
      return;
    }
    if (act === 'purge') {
      if (!CS().isSuperAdmin?.()) {
        CS().notify('Only super admins can permanently delete.', 'warn');
        return;
      }
      const ok = await CS().confirmAction({
        title: 'Delete permanently?',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete forever',
        danger: true
      });
      if (!ok) return;
      try {
        await instance.cfg.purge(id);
        CS().notify('Permanently deleted.', 'success');
        await refresh();
      } catch (e) {
        CS().notify(CS().humanizeError(e), 'error');
      }
    }
  }

  function syncBulkUi() {
    const root = instance.container.querySelector('.cms-table-root');
    if (!root) return;
    const n = instance.selected.size;
    const sel = root.querySelector('.cms-table-bulk');
    const btn = root.querySelector('.cms-table-bulk-apply');
    if (sel) sel.disabled = n === 0;
    if (btn) btn.disabled = n === 0;
    const inTrash = instance.statusTab === 'trash';
    if (sel) {
      [...sel.options].forEach((opt) => {
        if (opt.value === 'restore' || opt.value === 'purge') opt.hidden = !inTrash;
        if (opt.value === 'publish' || opt.value === 'draft' || opt.value === 'archive' || opt.value === 'trash') {
          opt.hidden = inTrash;
        }
      });
    }
  }

  async function runBulkAction() {
    const root = instance.container.querySelector('.cms-table-root');
    const action = root?.querySelector('.cms-table-bulk')?.value;
    const ids = [...instance.selected];
    if (!action || !ids.length) return;

    const ok = await CS().confirmAction({
      title: 'Apply bulk action?',
      message: `${action} on ${ids.length} item(s).`,
      confirmLabel: 'Apply',
      danger: action === 'purge' || action === 'trash'
    });
    if (!ok) return;

    let done = 0;
    for (const id of ids) {
      const row = instance.items.find((r) => r.id === id);
      if (!row) continue;
      if (row.isProtected && (action === 'trash' || action === 'purge')) continue;
      try {
        if (action === 'publish') await instance.cfg.save({ ...row.raw, status: 'published' }, true);
        else if (action === 'draft') await instance.cfg.save({ ...row.raw, status: 'draft' }, false);
        else if (action === 'archive') await instance.cfg.save({ ...row.raw, status: 'archived' }, false);
        else if (action === 'trash') await instance.cfg.softDelete(id);
        else if (action === 'restore') await instance.cfg.restore(id);
        else if (action === 'purge') await instance.cfg.purge(id);
        done++;
      } catch {
        /* continue */
      }
    }
    instance.selected.clear();
    CS().notify(`Bulk action applied to ${done} item(s).`, done ? 'success' : 'warn');
    await refresh();
  }

  return { renderContentTable, destroy, refresh: () => instance && refresh() };
})();
