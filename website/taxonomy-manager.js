/**
 * Unified taxonomy workspaces (categories / tags) — Pages & Posts.
 */
window.CutupTaxonomyManager = (function () {
  const CS = () => window.CutupContentStudio;
  const esc = (s) => CS().esc(s);

  let state = null;

  function destroy() {
    state = null;
  }

  function contentType(type) {
    return type === 'pages' ? 'pages' : 'posts';
  }

  function taxonomyKind(kind) {
    return kind === 'tags' ? 'tag' : 'category';
  }

  async function fetchTaxonomies(type, kind, q = '') {
    const data = await CS().apiGet('cmsTaxonomies', {
      contentType: contentType(type),
      kind: taxonomyKind(kind),
      q
    });
    return data.taxonomies || [];
  }

  function renderTaxonomyManager({ container, type, kind }) {
    destroy();
    if (!container) return;
    const ct = contentType(type);
    const tk = taxonomyKind(kind);
    const label = kind === 'tags' ? 'Tags' : 'Categories';
    const cfg = window.CutupContentConfig.get(ct === 'pages' ? 'pages' : 'posts');

    state = { container, type: ct, kind: tk, label, cfg, items: [], editId: null, q: '' };

    container.innerHTML = `<div class="cms-taxonomy-root">
      <header class="cms-taxonomy-head">
        <h2>${esc(cfg?.labelPlural || 'Content')} — ${esc(label)}</h2>
        <input type="search" class="cms-taxonomy-search" placeholder="Search…" data-tax-search />
      </header>
      <div class="cms-taxonomy-layout">
        <section class="cms-taxonomy-form-panel">
          <h3 data-tax-form-title>Add ${esc(label.slice(0, -1))}</h3>
          <form class="cms-taxonomy-form" data-tax-form>
            <input type="hidden" data-tax-id />
            <label>Name<input required data-tax-name /></label>
            <label>Slug<input data-tax-slug placeholder="auto from name" /></label>
            <label data-tax-parent-wrap hidden>Parent
              <select data-tax-parent><option value="">— None —</option></select>
            </label>
            <label>Description<textarea rows="3" data-tax-desc></textarea></label>
            <div class="cms-taxonomy-form-actions">
              <button type="submit" class="btn" data-tax-save>Save</button>
              <button type="button" class="btn ghost" data-tax-cancel hidden>Cancel</button>
            </div>
          </form>
        </section>
        <section class="cms-taxonomy-table-panel">
          <table class="cms-table cms-taxonomy-table">
            <thead><tr><th>Name</th><th>Slug</th><th>Count</th><th></th></tr></thead>
            <tbody data-tax-tbody></tbody>
          </table>
        </section>
      </div>
    </div>`;

    container.querySelector('[data-tax-search]')?.addEventListener('input', (ev) => {
      state.q = ev.target.value.trim();
      loadTable();
    });
    container.querySelector('[data-tax-form]')?.addEventListener('submit', onSave);
    container.querySelector('[data-tax-cancel]')?.addEventListener('click', resetForm);

    const parentWrap = container.querySelector('[data-tax-parent-wrap]');
    if (parentWrap) parentWrap.hidden = tk !== 'category';

    loadTable();
    if (tk === 'category') loadParentOptions();
  }

  async function loadParentOptions() {
    const sel = state.container.querySelector('[data-tax-parent]');
    if (!sel) return;
    const all = await fetchTaxonomies(state.type, 'categories');
    sel.innerHTML =
      '<option value="">— None —</option>' +
      all
        .filter((t) => t.id !== state.editId)
        .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
        .join('');
  }

  async function loadTable() {
    const tbody = state.container.querySelector('[data-tax-tbody]');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
    try {
      const items = await fetchTaxonomies(state.type, state.kind === 'tag' ? 'tags' : 'categories', state.q);
      state.items = items;
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No items yet.</td></tr>';
        return;
      }
      tbody.innerHTML = items
        .map(
          (t) => `<tr data-tax-row="${esc(t.id)}">
          <td><strong>${esc(t.name)}</strong>${t.description ? `<br><span class="muted" style="font-size:12px">${esc(t.description)}</span>` : ''}</td>
          <td><code>${esc(t.slug)}</code></td>
          <td>${esc(String(t.count || 0))}</td>
          <td class="cms-table-actions">
            <button type="button" class="btn ghost" data-tax-edit="${esc(t.id)}">Edit</button>
            <button type="button" class="btn ghost" data-tax-merge="${esc(t.id)}">Merge</button>
            <button type="button" class="btn ghost" data-tax-del="${esc(t.id)}">Delete</button>
          </td>
        </tr>`
        )
        .join('');
      tbody.querySelectorAll('[data-tax-edit]').forEach((btn) => {
        btn.addEventListener('click', () => startEdit(btn.getAttribute('data-tax-edit')));
      });
      tbody.querySelectorAll('[data-tax-del]').forEach((btn) => {
        btn.addEventListener('click', () => onDelete(btn.getAttribute('data-tax-del')));
      });
      tbody.querySelectorAll('[data-tax-merge]').forEach((btn) => {
        btn.addEventListener('click', () => onMerge(btn.getAttribute('data-tax-merge')));
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4">${esc(CS().humanizeError(e))}</td></tr>`;
    }
  }

  function resetForm() {
    state.editId = null;
    const form = state.container.querySelector('[data-tax-form]');
    form?.reset();
    state.container.querySelector('[data-tax-id]').value = '';
    state.container.querySelector('[data-tax-form-title]').textContent = `Add ${state.label.slice(0, -1)}`;
    state.container.querySelector('[data-tax-cancel]').hidden = true;
  }

  function startEdit(id) {
    const t = state.items.find((x) => x.id === id);
    if (!t) return;
    state.editId = id;
    state.container.querySelector('[data-tax-id]').value = id;
    state.container.querySelector('[data-tax-name]').value = t.name || '';
    state.container.querySelector('[data-tax-slug]').value = t.slug || '';
    state.container.querySelector('[data-tax-desc]').value = t.description || '';
    const parent = state.container.querySelector('[data-tax-parent]');
    if (parent) parent.value = t.parentId || '';
    state.container.querySelector('[data-tax-form-title]').textContent = `Edit ${t.name}`;
    state.container.querySelector('[data-tax-cancel]').hidden = false;
  }

  async function onSave(ev) {
    ev.preventDefault();
    const name = state.container.querySelector('[data-tax-name]')?.value?.trim();
    const slug = state.container.querySelector('[data-tax-slug]')?.value?.trim();
    const description = state.container.querySelector('[data-tax-desc]')?.value?.trim();
    const parentId = state.container.querySelector('[data-tax-parent]')?.value || null;
    if (!name) return;
    try {
      await CS().apiPost('saveCmsTaxonomy', {
        id: state.editId || null,
        contentType: state.type,
        taxonomyKind: state.kind,
        name,
        slug: slug || undefined,
        description,
        parentId
      });
      CS().notify('Saved.', 'success');
      resetForm();
      loadTable();
      if (state.kind === 'category') loadParentOptions();
    } catch (e) {
      CS().notify(CS().humanizeError(e), 'error');
    }
  }

  async function onDelete(id) {
    const t = state.items.find((x) => x.id === id);
    if (!t) return;
    if (!(await CS().confirmAction(`Delete “${t.name}”?`, 'Delete'))) return;
    try {
      await CS().apiPost('deleteCmsTaxonomy', { id });
      CS().notify('Deleted.', 'success');
      loadTable();
    } catch (e) {
      CS().notify(CS().humanizeError(e), 'error');
    }
  }

  async function onMerge(sourceId) {
    const src = state.items.find((x) => x.id === sourceId);
    if (!src) return;
    const targetName = window.prompt(`Merge “${src.name}” into which ${state.label.slice(0, -1)}? Enter exact name:`);
    if (!targetName) return;
    const target = state.items.find((x) => x.name.toLowerCase() === targetName.trim().toLowerCase());
    if (!target) {
      CS().notify('Target not found.', 'warn');
      return;
    }
    if (target.id === sourceId) return;
    try {
      await CS().apiPost('mergeCmsTaxonomy', { sourceId, targetId: target.id });
      CS().notify('Merged.', 'success');
      loadTable();
    } catch (e) {
      CS().notify(CS().humanizeError(e), 'error');
    }
  }

  return { renderTaxonomyManager, destroy };
})();
