/**
 * Unified CMS editor shell — shared layout for Pages and Posts.
 */
window.CutupContentEditor = (function () {
  const CS = () => window.CutupContentStudio;
  const esc = (s) => CS().esc(s);
  const ED = () => window.CutupCmsEditorState;

  let active = null;
  let saving = false;
  let lastContainer = null;

  function isActive() {
    if (!active?.container) return false;
    return Boolean(active.container.querySelector('.cms-editor-root'));
  }

  function isDirty() {
    if (!active) return false;
    const snap = readFullPayload();
    ED()?.check?.(snap);
    return ED()?.isDirty?.() || false;
  }

  function markDirty() {
    ED()?.markDirty?.();
  }

  function setSavingUi(on) {
    saving = on;
    const pub = active?.container?.querySelector('[data-ed-publish]');
    const draft = active?.container?.querySelector('[data-ed-save-draft]');
    if (pub) pub.disabled = on;
    if (draft) draft.disabled = on;
    if (on) ED()?.setSaving?.(true);
  }

  function destroyCurrentEditor() {
    if (active?.autosaveTimer) {
      clearInterval(active.autosaveTimer);
      active.autosaveTimer = null;
    }
    if (active?.keydownHandler) {
      document.removeEventListener('keydown', active.keydownHandler);
      active.keydownHandler = null;
    }
    const container = active?.container || lastContainer;
    if (container) container.innerHTML = '';
    ['contentPagesWorkspace', 'contentBlogWorkspace'].forEach((id) => {
      const el = document.getElementById(id);
      if (el?.querySelector('.cms-editor-root')) el.innerHTML = '';
    });
    active = null;
    saving = false;
    lastContainer = null;
    ED()?.reset?.();
  }

  function destroy() {
    destroyCurrentEditor();
  }

  function renderContentEditor(opts) {
    destroyCurrentEditor();
    const type = opts.type === 'pages' ? 'pages' : 'posts';
    const cfg = window.CutupContentConfig.get(type);
    if (!opts.container || !cfg) return null;

    lastContainer = opts.container;
    active = {
      container: opts.container,
      type,
      cfg,
      item: opts.item,
      slugManual: Boolean(opts.item?.id),
      onBack: opts.onBack,
      onSaved: opts.onSaved,
      bodyApi: opts.bodyApi,
      autosaveTimer: null,
      keydownHandler: null
    };

    opts.container.innerHTML = shellHtml(cfg, opts.item);
    bindShell();
    const bodyHost = opts.container.querySelector('#cmsEditorMainBody');
    active.bodyApi.mount(bodyHost, opts.item);
    fillSidebar(opts.item);
    if (active.bodyApi.fill) active.bodyApi.fill(opts.item);
    ED()?.capture?.(readFullPayload());
    bindDirtyListeners();
    scheduleAutosave();
    return active;
  }

  function shellHtml(cfg, item) {
    const isNew = !item?.id;
    const backId = cfg.key === 'pages' ? 'cmsBackPages' : 'cmsBackPosts';
    const backKind = cfg.key === 'pages' ? 'pages' : 'posts';
    return `<div class="cms-editor-root" data-editor-type="${esc(cfg.key)}">
      <div class="cms-editor-toolbar cms-editor-toolbar--sticky">
        <button type="button" class="btn ghost" id="${backId}" data-cms-back="${backKind}" data-ed-back>← All ${esc(cfg.labelPlural)}</button>
        <span class="cms-editor-toolbar-title">${isNew ? esc('Add ' + cfg.label) : esc(item?.title || cfg.label)}</span>
        <span class="cms-save-status" data-cms-save-status aria-live="polite"></span>
        <span style="flex:1"></span>
        <button type="button" class="btn ghost" data-ed-preview>Preview</button>
        <button type="button" class="btn ghost" data-ed-save-draft>Save draft</button>
        <button type="button" class="btn" data-ed-publish>Publish</button>
      </div>
      <div class="cms-editor-layout">
        <div class="cms-editor-main">
          <div id="cmsEditorMainBody" class="cms-editor-main-body"></div>
          <section class="cms-editor-seo-preview" aria-label="SEO preview">
            <h4>Search preview</h4>
            <p class="cms-seo-prev-title" id="cmsSeoPrevTitle">Title preview</p>
            <p class="cms-seo-prev-url muted" id="cmsSeoPrevUrl">https://cutup.shop/…</p>
            <p class="cms-seo-prev-desc" id="cmsSeoPrevDesc">Meta description preview.</p>
          </section>
        </div>
        <aside class="cms-editor-sidebar">
          <section class="cms-sidebar-panel">
            <h3>Publish</h3>
            <label>Status
              <select id="cmsEdStatus">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="scheduled">Scheduled</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>Visibility<span class="muted" style="font-size:11px;display:block">Public when published</span></label>
            <label>Slug<input id="cmsEdSlug" /></label>
            <label>Schedule<input id="cmsEdScheduled" type="datetime-local" /></label>
            <label id="cmsEdCategoryWrap">${esc(cfg.categoryLabel || 'Category')}
              <input id="cmsEdCategory" list="cmsEdCategoryList" />
              <datalist id="cmsEdCategoryList"></datalist>
            </label>
            <label id="cmsEdTagsWrap" hidden>Tags (comma)<input id="cmsEdTags" /></label>
            <label>Featured image
              <div id="cmsEdFeaturedMount" class="cms-media-field-mount"></div>
            </label>
            <label class="cms-check-row"><input type="checkbox" id="cmsEdHomepage" hidden /> Homepage</label>
          </section>
          <section class="cms-sidebar-panel">
            <h3>SEO</h3>
            <label>Meta title<input id="cmsEdMetaTitle" /></label>
            <label>Meta description<textarea id="cmsEdMetaDesc" rows="2"></textarea></label>
            <label>Canonical URL<input id="cmsEdCanonical" /></label>
            <label>OG title<input id="cmsEdOgTitle" /></label>
            <label>OG description<textarea id="cmsEdOgDesc" rows="2"></textarea></label>
          </section>
          <input type="hidden" id="cmsEdId" />
        </aside>
      </div>
    </div>`;
  }

  function bindDirtyListeners() {
    const root = active?.container?.querySelector('.cms-editor-root');
    if (!root) return;
    root.querySelectorAll('input, textarea, select').forEach((el) => {
      el.addEventListener('input', () => {
        markDirty();
        updateSeoPreview();
      });
      el.addEventListener('change', markDirty);
    });
  }

  function initFeaturedImageField(item) {
    const mount = document.getElementById('cmsEdFeaturedMount');
    const MF = window.CutupMediaField;
    if (!mount || !MF?.renderMediaField) return;
    const p = item || active?.item || {};
    const val =
      active?.type === 'pages'
        ? p.ogImageUrl || ''
        : p.coverImageUrl || p.ogImageUrl || '';
    if (!mount.dataset.cmsMediaMounted) {
      MF.renderMediaField({
        container: mount,
        value: val,
        inputId: 'cmsEdFeatured',
        accept: 'image/*',
        onChange: () => {
          markDirty();
          updateSeoPreview();
        }
      });
      mount.dataset.cmsMediaMounted = '1';
    } else {
      MF.setValue(mount, document.getElementById('cmsEdFeatured')?.value?.trim() || val);
    }
  }

  function fillSidebar(item) {
    const p = item || {};
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v ?? '';
    };
    set('cmsEdId', p.id);
    set('cmsEdSlug', p.slug);
    set('cmsEdStatus', p.status || 'draft');
    set('cmsEdScheduled', p.scheduledAt ? String(p.scheduledAt).slice(0, 16) : '');
    set('cmsEdMetaTitle', p.metaTitle || p.seoTitle);
    set('cmsEdMetaDesc', p.metaDescription);
    set('cmsEdCanonical', p.canonicalUrl);
    set('cmsEdOgTitle', p.ogTitle);
    set('cmsEdOgDesc', p.ogDescription);

    const cat = document.getElementById('cmsEdCategory');
    const tagsWrap = document.getElementById('cmsEdTagsWrap');
    const home = document.getElementById('cmsEdHomepage');
    if (active.type === 'pages') {
      if (cat) cat.value = p.template || 'default';
      if (home) {
        home.hidden = false;
        home.checked = Boolean(p.isHomepage);
      }
      if (tagsWrap) tagsWrap.hidden = true;
      const dl = document.getElementById('cmsEdCategoryList');
      if (dl) {
        dl.innerHTML = (active.cfg.categoryOptions || [])
          .map((c) => `<option value="${esc(c)}"></option>`)
          .join('');
      }
    } else {
      if (cat) cat.value = p.category || '';
      if (tagsWrap) {
        tagsWrap.hidden = false;
        set('cmsEdTags', (p.tags || []).join(', '));
      }
      if (home) home.hidden = true;
      CS()
        .apiGet('blogCategories')
        .then((data) => {
          const dl = document.getElementById('cmsEdCategoryList');
          if (!dl) return;
          dl.innerHTML = (data.categories || [])
            .map((c) => `<option value="${esc(c.name || c.slug)}"></option>`)
            .join('');
        })
        .catch(() => {});
    }
    initFeaturedImageField(p);
    updateSeoPreview();
  }

  function readSidebar() {
    const tagsRaw = document.getElementById('cmsEdTags')?.value || '';
    const base = {
      id: document.getElementById('cmsEdId')?.value?.trim() || null,
      slug: document.getElementById('cmsEdSlug')?.value?.trim() || '',
      status: document.getElementById('cmsEdStatus')?.value || 'draft',
      scheduledAt: document.getElementById('cmsEdScheduled')?.value || null,
      metaTitle: document.getElementById('cmsEdMetaTitle')?.value?.trim() || '',
      metaDescription: document.getElementById('cmsEdMetaDesc')?.value?.trim() || '',
      canonicalUrl: document.getElementById('cmsEdCanonical')?.value?.trim() || '',
      ogTitle: document.getElementById('cmsEdOgTitle')?.value?.trim() || '',
      ogDescription: document.getElementById('cmsEdOgDesc')?.value?.trim() || ''
    };
    if (active.type === 'pages') {
      return {
        ...base,
        template: document.getElementById('cmsEdCategory')?.value?.trim() || 'default',
        ogImageUrl: document.getElementById('cmsEdFeatured')?.value?.trim() || '',
        isHomepage: document.getElementById('cmsEdHomepage')?.checked || false
      };
    }
    return {
      ...base,
      seoTitle: base.metaTitle,
      category: document.getElementById('cmsEdCategory')?.value?.trim() || '',
      tags: tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      coverImageUrl: document.getElementById('cmsEdFeatured')?.value?.trim() || '',
      ogImageUrl: document.getElementById('cmsEdFeatured')?.value?.trim() || ''
    };
  }

  function readFullPayload() {
    const body = active.bodyApi.read() || {};
    const side = readSidebar();
    return { ...active.item, ...body, ...side };
  }

  function updateSeoPreview() {
    const title =
      document.getElementById('cmsEdMetaTitle')?.value?.trim() ||
      active.bodyApi.readTitle?.() ||
      active.item?.title ||
      'Untitled';
    const slug = document.getElementById('cmsEdSlug')?.value?.trim() || '';
    const desc = document.getElementById('cmsEdMetaDesc')?.value?.trim() || '';
    const t = document.getElementById('cmsSeoPrevTitle');
    const u = document.getElementById('cmsSeoPrevUrl');
    const d = document.getElementById('cmsSeoPrevDesc');
    if (t) t.textContent = title;
    if (u) {
      u.textContent =
        active.type === 'pages'
          ? `${window.location.origin}/${slug === 'home' ? '' : (slug ? slug + '.html' : '…')}`
          : `${window.location.origin}/blog/${encodeURIComponent(slug || '')}`;
    }
    if (d) d.textContent = desc || '—';
  }

  async function requestLeave() {
    if (!isActive()) return 'leave';
    const snap = readFullPayload();
    ED()?.check?.(snap);
    if (!ED()?.isDirty?.()) return 'leave';
    const choice = await ED()?.confirmLeave?.(() => persist(false, { silent: true }));
    return choice === 'leave' ? 'leave' : 'cancel';
  }

  function backKindToSection(backKind) {
    return backKind === 'pages' ? 'pages' : 'blog';
  }

  async function handleBack(ev, backKind) {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (navigatingBack) return;

    const kind =
      backKind ||
      ev?.currentTarget?.getAttribute?.('data-cms-back') ||
      ev?.target?.closest?.('[data-cms-back]')?.getAttribute('data-cms-back');
    const section = backKindToSection(kind);

    if (kind === 'pages') console.log('[CMS Back] Pages clicked');
    else if (kind === 'posts') console.log('[CMS Back] Posts clicked');
    else console.log('[CMS Back] header back clicked', { kind, section });

    if (!document.querySelector('.cms-editor-root')) {
      console.warn('[CMS Back] no editor shell in DOM');
      return;
    }

    navigatingBack = true;
    try {
      const result = await requestLeave();
      if (result !== 'leave') {
        console.log('[CMS Back] navigation cancelled');
        return;
      }

      console.log('[CMS Back] navigating to list', { section, view: 'all' });

      if (window.CutupCmsNav?.navigate) {
        await window.CutupCmsNav.navigate(section, 'all', { replace: false, skipGuard: true });
        return;
      }

      if (window.CutupCmsNav?.navigateToList) {
        await window.CutupCmsNav.navigateToList(section, 'all');
        return;
      }

      const onBack = active?.onBack;
      destroyCurrentEditor();
      if (onBack) await onBack();
    } catch (err) {
      console.error('[CMS Back] navigation failed', err);
      CS().notify?.(CS().humanizeError?.(err) || 'Could not return to list.', 'error');
    } finally {
      navigatingBack = false;
    }
  }

  let headerBackBound = false;
  let navigatingBack = false;
  function bindHeaderBackButtons() {
    if (headerBackBound) return;
    headerBackBound = true;
    document.addEventListener(
      'click',
      (ev) => {
        const btn = ev.target.closest?.('[data-cms-back]');
        if (!btn || !btn.closest('.cms-editor-root')) return;
        void handleBack(ev, btn.getAttribute('data-cms-back'));
      },
      true
    );
  }

  function bindShell() {
    bindHeaderBackButtons();
    const root = active.container.querySelector('.cms-editor-root');
    root?.querySelector('[data-ed-preview]')?.addEventListener('click', () => {
      const payload = readFullPayload();
      const url = active.cfg.previewUrl({ slug: payload.slug, raw: payload });
      if (url) window.open(url, '_blank');
    });
    root?.querySelector('[data-ed-save-draft]')?.addEventListener('click', () => persist(false));
    root?.querySelector('[data-ed-publish]')?.addEventListener('click', () => persist(true));

    active.keydownHandler = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
        ev.preventDefault();
        persist(false);
      }
    };
    document.addEventListener('keydown', active.keydownHandler);
  }

  async function persist(publish, opts = {}) {
    if (saving) return;
    const payload = readFullPayload();
    if (!payload.title || !payload.slug) {
      if (!opts.silent) CS().notify('Title and slug are required.', 'warn');
      return;
    }
    setSavingUi(true);
    try {
      const id = await active.cfg.save(payload, publish);
      const fresh =
        (await active.cfg.fetchOne(id, { hydrate: 0, persist: 0, force: 0 })) || { ...payload, id };
      active.item = fresh;
      document.getElementById('cmsEdId').value = id;
      if (active.bodyApi.fill && fresh.sections) active.bodyApi.fill(fresh);
      ED()?.markClean?.(readFullPayload());
      console.log('[CMS Save]', { id, slug: payload.slug, publish: Boolean(publish) });
      active.onSaved?.(fresh);
      if (!opts.silent) CS().notify(publish ? 'Published.' : 'Draft saved.', 'success');
    } catch (e) {
      ED()?.setError?.(CS().humanizeError(e));
      if (!opts.silent) CS().notify(CS().humanizeError(e), 'error');
      throw e;
    } finally {
      setSavingUi(false);
    }
  }

  function scheduleAutosave() {
    if (active.autosaveTimer) clearInterval(active.autosaveTimer);
    active.autosaveTimer = setInterval(() => {
      if (!isDirty() || saving) return;
      persist(false, { silent: true }).catch(() => {});
    }, 45000);
  }

  bindHeaderBackButtons();

  return {
    renderContentEditor,
    destroy,
    destroyCurrentEditor,
    readFullPayload: () => (active ? readFullPayload() : null),
    isActive,
    isDirty,
    markDirty,
    requestLeave,
    persist,
    handleBack
  };
})();
