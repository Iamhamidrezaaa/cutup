/**
 * Content Studio — Pages (unified CMS table + block editor)
 */
window.CutupContentPages = (function () {
  const CS = () => window.CutupContentStudio;
  const { esc, apiGet, apiPost, statusBadge, fmtDate, slugify, notify, humanizeError, confirmAction, TRASH_ICON_SRC } =
    window.CutupContentStudio;

  let slugManual = false;
  let pageBlocks = [];

  const BLOCK_CATALOG = [
    { type: 'hero', label: 'Hero', icon: '◆' },
    { type: 'richtext', label: 'Rich text', icon: '¶' },
    { type: 'features', label: 'Features', icon: '▦' },
    { type: 'cta', label: 'Call to action', icon: '→' },
    { type: 'faq', label: 'FAQ', icon: '?' },
    { type: 'testimonials', label: 'Testimonials', icon: '“' },
    { type: 'pricing', label: 'Pricing', icon: '€' },
    { type: 'stats', label: 'Stats / steps', icon: '#' },
    { type: 'logos', label: 'Logos', icon: '◎' },
    { type: 'split', label: 'Split section', icon: '⊞' },
    { type: 'image', label: 'Image', icon: '🖼' },
    { type: 'gallery', label: 'Gallery', icon: '▤' },
    { type: 'video', label: 'Video', icon: '▶' },
    { type: 'html', label: 'HTML / custom', icon: '<>' }
  ];

  function root() {
    return document.getElementById('contentPagesWorkspace');
  }

  function seoScore(p) {
    let n = 0;
    if ((p.metaTitle || '').length >= 20) n += 40;
    if ((p.metaDescription || '').length >= 60) n += 40;
    if (p.ogImageUrl) n += 20;
    return Math.min(100, n);
  }

  function defaultBlock(type) {
    const map = {
      hero: { type: 'hero', title: '', subtitle: '', body: '', imageUrl: '', ctaLabel: '', ctaUrl: '' },
      richtext: { type: 'richtext', body: '' },
      features: { type: 'features', heading: '', items: [{ title: '', text: '' }] },
      cta: { type: 'cta', title: '', text: '', buttonLabel: '', buttonUrl: '' },
      faq: { type: 'faq', heading: 'FAQ', items: [{ q: '', a: '' }] },
      testimonials: { type: 'testimonials', items: [{ quote: '', author: '' }] },
      pricing: {
        type: 'pricing',
        heading: '',
        intro: '',
        footnote: '',
        plans: [{ name: '', priceLine: '', description: '', bullets: [], ctaLabel: '', ctaUrl: '' }]
      },
      stats: { type: 'stats', heading: '', items: [{ value: '', label: '', text: '' }] },
      logos: { type: 'logos', heading: '', items: [{ name: '', url: '' }] },
      split: {
        type: 'split',
        heading: '',
        leftTitle: '',
        leftBody: '',
        rightTitle: '',
        rightBody: '',
        imageUrl: ''
      },
      image: { type: 'image', url: '', alt: '', caption: '' },
      gallery: { type: 'gallery', heading: '', images: [{ url: '', alt: '', caption: '' }] },
      video: { type: 'video', url: '', caption: '' },
      html: { type: 'html', label: '', html: '', note: '' }
    };
    return { ...(map[type] || map.richtext) };
  }

  function parseSections(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function normalizeBlocks(sections, content) {
    const list = parseSections(sections);
    if (list.length) return list.map((s) => ({ ...s }));
    if (content) return [{ type: 'richtext', body: content }];
    return [];
  }

  function applyPageBlocks(page) {
    pageBlocks = normalizeBlocks(page?.sections, page?.content);
    if (page?.heroTitle || page?.heroSubtitle) {
      const hero = pageBlocks.find((b) => b.type === 'hero');
      if (hero) {
        if (!hero.title) hero.title = page.heroTitle || '';
        if (!hero.subtitle) hero.subtitle = page.heroSubtitle || '';
      } else if (!pageBlocks.length) {
        pageBlocks.unshift({
          type: 'hero',
          title: page.heroTitle || '',
          subtitle: page.heroSubtitle || '',
          body: '',
          imageUrl: '',
          ctaLabel: '',
          ctaUrl: ''
        });
      }
    }
    if (window.__cmsDebug) {
      window.__cmsDebug.normalizedBlocks = {
        count: pageBlocks.length,
        types: pageBlocks.map((b) => b.type)
      };
    }
    renderBlocks();
  }

  const MF = () => window.CutupMediaField;

  function mediaField(label, bf, i, value) {
    if (MF()?.hostMarkup) return MF().hostMarkup({ label, dataBf: bf, dataI: i, value });
    return `<label>${esc(label)}<input data-bf="${esc(bf)}" data-i="${i}" value="${esc(value || '')}"></label>`;
  }

  function blockFieldsHtml(b, index) {
    const i = index;
    if (b.type === 'hero') {
      return `<label>Title<input data-bf="title" data-i="${i}" value="${esc(b.title || '')}"></label>
        <label>Subtitle<input data-bf="subtitle" data-i="${i}" value="${esc(b.subtitle || '')}"></label>
        <label>Body<textarea data-bf="body" data-i="${i}" rows="2">${esc(b.body || '')}</textarea></label>
        ${mediaField('Hero image', 'imageUrl', i, b.imageUrl)}
        <div class="form-grid-2"><label>CTA label<input data-bf="ctaLabel" data-i="${i}" value="${esc(b.ctaLabel || '')}"></label>
        <label>CTA URL<input data-bf="ctaUrl" data-i="${i}" value="${esc(b.ctaUrl || '')}"></label></div>`;
    }
    if (b.type === 'richtext') {
      return `<label>Content<textarea data-bf="body" data-i="${i}" class="cs-block-text" rows="6">${esc(b.body || '')}</textarea></label>`;
    }
    if (b.type === 'features') {
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        <label>Items (one per line: title | description)<textarea data-bf="itemsText" data-i="${i}" class="cs-block-text" rows="4">${esc(
          (b.items || []).map((x) => `${x.title || ''} | ${x.text || ''}`).join('\n')
        )}</textarea></label>`;
    }
    if (b.type === 'cta') {
      return `<label>Title<input data-bf="title" data-i="${i}" value="${esc(b.title || '')}"></label>
        <label>Text<textarea data-bf="text" data-i="${i}" rows="2">${esc(b.text || '')}</textarea></label>
        <label>Button<input data-bf="buttonLabel" data-i="${i}" value="${esc(b.buttonLabel || '')}"></label>
        <label>URL<input data-bf="buttonUrl" data-i="${i}" value="${esc(b.buttonUrl || '')}"></label>`;
    }
    if (b.type === 'faq') {
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        <label>Q&A (line: question | answer)<textarea data-bf="itemsText" data-i="${i}" class="cs-block-text" rows="5">${esc(
          (b.items || []).map((x) => `${x.q || ''} | ${x.a || ''}`).join('\n')
        )}</textarea></label>`;
    }
    if (b.type === 'testimonials') {
      return `<label>Quotes (line: quote | author)<textarea data-bf="itemsText" data-i="${i}" class="cs-block-text" rows="4">${esc(
          (b.items || []).map((x) => `${x.quote || ''} | ${x.author || ''}`).join('\n')
        )}</textarea></label>`;
    }
    if (b.type === 'pricing') {
      const plansText = (b.plans || [])
        .map((p) =>
          [
            p.name || '',
            p.priceLine || '',
            p.description || '',
            (p.bullets || []).join('; '),
            p.ctaLabel || '',
            p.ctaUrl || ''
          ].join(' | ')
        )
        .join('\n');
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        <label>Intro<textarea data-bf="intro" data-i="${i}" rows="2">${esc(b.intro || '')}</textarea></label>
        <label>Plans (line: name | price | description | bullets ; sep | cta | url)<textarea data-bf="plansText" data-i="${i}" class="cs-block-text" rows="6">${esc(plansText)}</textarea></label>
        <label>Footnote<textarea data-bf="footnote" data-i="${i}" rows="2">${esc(b.footnote || '')}</textarea></label>`;
    }
    if (b.type === 'stats') {
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        <label>Items (line: value | label | text)<textarea data-bf="itemsText" data-i="${i}" class="cs-block-text" rows="4">${esc(
          (b.items || []).map((x) => `${x.value || ''} | ${x.label || ''} | ${x.text || ''}`).join('\n')
        )}</textarea></label>`;
    }
    if (b.type === 'logos') {
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        ${MF()?.logosToolbarHtml?.(i) || ''}
        <label>Logos (line: name | url)<textarea data-bf="itemsText" data-i="${i}" class="cs-block-text" rows="3">${esc(
          (b.items || []).map((x) => `${x.name || ''} | ${x.url || ''}`).join('\n')
        )}</textarea></label>`;
    }
    if (b.type === 'split') {
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        <label>Left title<input data-bf="leftTitle" data-i="${i}" value="${esc(b.leftTitle || '')}"></label>
        <label>Left body<textarea data-bf="leftBody" data-i="${i}" rows="3">${esc(b.leftBody || '')}</textarea></label>
        <label>Right title<input data-bf="rightTitle" data-i="${i}" value="${esc(b.rightTitle || '')}"></label>
        <label>Right body<textarea data-bf="rightBody" data-i="${i}" rows="3">${esc(b.rightBody || '')}</textarea></label>
        ${mediaField('Image', 'imageUrl', i, b.imageUrl)}`;
    }
    if (b.type === 'gallery') {
      return `<label>Heading<input data-bf="heading" data-i="${i}" value="${esc(b.heading || '')}"></label>
        ${MF()?.galleryToolbarHtml?.(i) || ''}
        <label>Images (line: url | alt | caption)<textarea data-bf="imagesText" data-i="${i}" class="cs-block-text" rows="4">${esc(
          (b.images || []).map((x) => `${x.url || ''} | ${x.alt || ''} | ${x.caption || ''}`).join('\n')
        )}</textarea></label>`;
    }
    if (b.type === 'html') {
      return `<label>Label<input data-bf="label" data-i="${i}" value="${esc(b.label || '')}"></label>
        <label>HTML<textarea data-bf="html" data-i="${i}" class="cs-block-text" rows="5">${esc(b.html || '')}</textarea></label>
        <label>Editor note<textarea data-bf="note" data-i="${i}" rows="2">${esc(b.note || '')}</textarea></label>`;
    }
    if (b.type === 'image') {
      return `${mediaField('Image', 'url', i, b.url)}
        <label>Alt<input data-bf="alt" data-i="${i}" value="${esc(b.alt || '')}"></label>
        <label>Caption<input data-bf="caption" data-i="${i}" value="${esc(b.caption || '')}"></label>`;
    }
    if (b.type === 'video') {
      return `<label>Video URL<input data-bf="url" data-i="${i}" value="${esc(b.url || '')}"></label>
        <label>Caption<input data-bf="caption" data-i="${i}" value="${esc(b.caption || '')}"></label>`;
    }
    return '';
  }

  function renderBlocks() {
    const host = document.getElementById('csPageBlocks');
    if (!host) return;
    host.innerHTML = pageBlocks
      .map((b, i) => {
        const meta = BLOCK_CATALOG.find((x) => x.type === b.type) || { label: b.type, icon: '•' };
        return `<article class="cs-block" data-block-index="${i}" draggable="true">
          <header class="cs-block-head">
            <span class="cs-block-grip" title="Drag to reorder">⋮⋮</span>
            <strong>${esc(meta.icon)} ${esc(meta.label)}</strong>
            <span style="flex:1"></span>
            <button type="button" class="btn ghost cs-block-btn cs-block-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
            <button type="button" class="btn ghost cs-block-btn cs-block-down" data-i="${i}" ${i === pageBlocks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
            <button type="button" class="btn ghost cs-block-btn cs-block-dup" data-i="${i}" title="Duplicate">⧉</button>
            <button type="button" class="btn ghost cs-block-btn cs-block-toggle" data-i="${i}" title="Collapse">▾</button>
            <button type="button" class="cs-icon-btn cs-icon-btn--danger cs-block-btn cs-block-del" data-i="${i}" title="Remove block">
              <img src="${TRASH_ICON_SRC}" alt="" width="14" height="14">
            </button>
          </header>
          <div class="cs-block-body">${blockFieldsHtml(b, i)}</div>
        </article>`;
      })
      .join('');

    const markBlockDirty = () => window.CutupContentEditor?.markDirty?.();
    host.querySelectorAll('[data-bf]').forEach((el) => {
      el.addEventListener('input', () => {
        syncBlockFromDom(Number(el.getAttribute('data-i')));
        markBlockDirty();
      });
    });
    MF()?.hydrate?.(host, () => {
      host.querySelectorAll('[data-bf]').forEach((el) => {
        syncBlockFromDom(Number(el.getAttribute('data-i')));
      });
      markBlockDirty();
    });
    MF()?.bindGalleryPickers?.(host, markBlockDirty);
    host.querySelectorAll('.cs-block-dup').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-i'));
        pageBlocks.splice(i + 1, 0, { ...pageBlocks[i] });
        renderBlocks();
      });
    });
    host.querySelectorAll('.cs-block-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        pageBlocks.splice(Number(btn.getAttribute('data-i')), 1);
        renderBlocks();
      });
    });
    host.querySelectorAll('.cs-block-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-i'));
        if (i > 0) {
          [pageBlocks[i - 1], pageBlocks[i]] = [pageBlocks[i], pageBlocks[i - 1]];
          renderBlocks();
        }
      });
    });
    host.querySelectorAll('.cs-block-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-i'));
        if (i < pageBlocks.length - 1) {
          [pageBlocks[i], pageBlocks[i + 1]] = [pageBlocks[i + 1], pageBlocks[i]];
          renderBlocks();
        }
      });
    });
    host.querySelectorAll('.cs-block-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.cs-block');
        card?.classList.toggle('is-collapsed');
        btn.textContent = card?.classList.contains('is-collapsed') ? '▸' : '▾';
      });
    });
  }

  function parseItemsText(text, mode) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [a, b] = line.split('|').map((s) => s.trim());
        if (mode === 'faq') return { q: a || '', a: b || '' };
        if (mode === 'testimonials') return { quote: a || '', author: b || '' };
        return { title: a || '', text: b || '' };
      });
  }

  function syncBlockFromDom(index) {
    const b = { ...pageBlocks[index] };
    const card = document.querySelector(`.cs-block[data-block-index="${index}"]`);
    if (!card) return;
    card.querySelectorAll('[data-bf]').forEach((el) => {
      const key = el.getAttribute('data-bf');
      if (key === 'itemsText' || key === 'plansText' || key === 'imagesText') return;
      b[key] = el.value;
    });
    const itemsEl = card.querySelector('[data-bf="itemsText"]');
    if (itemsEl) {
      if (b.type === 'faq') b.items = parseItemsText(itemsEl.value, 'faq');
      else if (b.type === 'testimonials') b.items = parseItemsText(itemsEl.value, 'testimonials');
      else if (b.type === 'stats') {
        b.items = String(itemsEl.value || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [value, label, text] = line.split('|').map((s) => s.trim());
            return { value: value || '', label: label || '', text: text || '' };
          });
      } else if (b.type === 'logos') {
        b.items = String(itemsEl.value || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [name, url] = line.split('|').map((s) => s.trim());
            return { name: name || '', url: url || '' };
          });
      } else b.items = parseItemsText(itemsEl.value, 'features');
    }
    const plansEl = card.querySelector('[data-bf="plansText"]');
    if (plansEl && b.type === 'pricing') {
      b.plans = String(plansEl.value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, priceLine, description, bullets, ctaLabel, ctaUrl] = line
            .split('|')
            .map((s) => s.trim());
          return {
            name: name || '',
            priceLine: priceLine || '',
            description: description || '',
            bullets: bullets ? bullets.split(';').map((s) => s.trim()).filter(Boolean) : [],
            ctaLabel: ctaLabel || '',
            ctaUrl: ctaUrl || ''
          };
        });
    }
    const imagesEl = card.querySelector('[data-bf="imagesText"]');
    if (imagesEl && b.type === 'gallery') {
      b.images = String(imagesEl.value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [url, alt, caption] = line.split('|').map((s) => s.trim());
          return { url: url || '', alt: alt || '', caption: caption || '' };
        });
    }
    pageBlocks[index] = b;
  }

  function syncAllBlocksFromDom() {
    pageBlocks.forEach((_, i) => syncBlockFromDom(i));
  }

  function blocksToContent() {
    return pageBlocks
      .filter((b) => b.type === 'richtext')
      .map((b) => b.body || '')
      .join('\n\n');
  }

  const pagesBodyApi = {
    mount(host, page) {
      const blocksMenu = BLOCK_CATALOG.map(
        (b) =>
          `<button type="button" class="btn ghost" data-add-block="${b.type}">${b.icon} ${esc(b.label)}</button>`
      ).join('');
      host.innerHTML = `
        <div class="cms-field-title"><input id="cmsPageTitle" placeholder="Page title" value="${esc(page?.title || '')}" /></div>
        <div class="cs-block-add-bar">${blocksMenu}</div>
        <div id="csPageBlocks" class="cs-block-list"></div>`;
      host.querySelectorAll('[data-add-block]').forEach((btn) => {
        btn.addEventListener('click', () => {
          pageBlocks.push(defaultBlock(btn.getAttribute('data-add-block')));
          renderBlocks();
        });
      });
      document.getElementById('cmsPageTitle')?.addEventListener('input', (ev) => {
        if (!slugManual) {
          const s = document.getElementById('cmsEdSlug');
          if (s) s.value = slugify(ev.target.value);
        }
        window.CutupContentEditor?.markDirty?.();
      });
    },
    readTitle() {
      return document.getElementById('cmsPageTitle')?.value?.trim() || '';
    },
    read() {
      syncAllBlocksFromDom();
      const hero = pageBlocks.find((b) => b.type === 'hero');
      return {
        title: document.getElementById('cmsPageTitle')?.value?.trim() || '',
        heroTitle: hero?.title || '',
        heroSubtitle: hero?.subtitle || '',
        content: blocksToContent(),
        sections: pageBlocks
      };
    },
    fill(page) {
      applyPageBlocks(page);
    },
    setBlocks(sections) {
      pageBlocks = normalizeBlocks(sections, '');
      renderBlocks();
    }
  };

  function showTable() {
    window.CutupContentEditor?.destroy?.();
    const el = root();
    if (!el) return;
    window.CutupContentTable.renderContentTable({
      container: el,
      type: 'pages',
      onEdit: (item) => openEditor(item),
      onAdd: () => openEditor(null)
    });
  }

  async function fetchPageSafe(page, opts = {}) {
    const base = { id: page.id, hydrate: opts.hydrate ?? 1, persist: opts.persist ?? 0, force: opts.force ?? 0 };
    try {
      const res = await apiGet('cmsPage', base);
      if (res.hydrationDebug) window.CutupCmsHydration?.mergeServerDebug?.(res.hydrationDebug);
      if (res.hydrationError) {
        console.warn('[CMS Hydrate] server warning', res.hydrationError);
        notify(`Hydration note: ${res.hydrationError}`, 'warn', 6000);
      }
      return res.page || page;
    } catch (e) {
      const msg = humanizeError(e);
      if (window.__cmsDebug) window.__cmsDebug.lastApiError = msg;
      console.error('[CMS] cmsPage failed', msg, e);
      notify(`Could not hydrate from server: ${msg}`, 'error');
      try {
        const res2 = await apiGet('cmsPage', { id: page.id, hydrate: 0, persist: 0, force: 0 });
        let data = res2.page || page?.raw || page;
        if (window.CutupCmsHydration?.hydratePage) {
          data = await window.CutupCmsHydration.hydratePage(data);
          if (window.__cmsDebug) window.__cmsDebug.hydratedPage = data;
        }
        return data;
      } catch (e2) {
        if (window.__cmsDebug) window.__cmsDebug.lastApiError = humanizeError(e2);
        return page?.raw || page;
      }
    }
  }

  async function loadPageForEditor(page) {
    const needsForce =
      page?.isSystem || ['home', 'about', 'contact', 'privacy', 'terms'].includes(page?.slug);
    let data = await fetchPageSafe(page, {
      hydrate: 1,
      persist: 0,
      force: needsForce ? 1 : 0
    });
    const needsClient =
      window.CutupCmsHydration?.sectionsNeedHydration?.(data.sections) ||
      !(data.sections || []).length;
    if (needsClient && window.CutupCmsHydration?.hydratePage) {
      console.log('[CMS Hydrate] client fallback', data.slug);
      data = await window.CutupCmsHydration.hydratePage(data);
      if (window.__cmsDebug) window.__cmsDebug.hydratedPage = data;
      if (data.sections?.length && data.id) {
        try {
          await apiPost('saveCmsPage', { ...data, status: data.status || 'draft' });
          const again = await apiGet('cmsPage', { id: data.id, hydrate: 0, persist: 0, force: 0 });
          data = again.page || data;
        } catch (e) {
          console.warn('[CMS Persist] client save skipped', e?.message || e);
        }
      }
    }
    if (window.__cmsDebug) {
      window.__cmsDebug.loadedPage = {
        slug: data.slug,
        sectionCount: (data.sections || []).length,
        sections: data.sections
      };
    }
    return data;
  }

  async function openEditor(page) {
    window.CutupContentTable?.destroy?.();
    const el = root();
    if (!el) return;
    el.innerHTML =
      '<div class="cms-editor-loading"><div class="cs-skeleton" style="height:120px"></div><p class="muted">Loading page content…</p></div>';

    let data = page;
    try {
      if (page?.id) data = await loadPageForEditor(page);
    } catch (e) {
      notify(humanizeError(e), 'error');
      data = page?.raw || page;
    }

    if (!data) {
      data = {
        id: '',
        slug: '',
        title: '',
        sections: [],
        content: '',
        template: 'default',
        status: 'draft',
        isHomepage: false,
        isSystem: false
      };
    }
    slugManual = Boolean(data.id);

    window.CutupContentEditor.renderContentEditor({
      container: el,
      type: 'pages',
      item: data,
      onBack: () => showTable(),
      onSaved: (fresh) => {
        if (fresh?.sections) pagesBodyApi.setBlocks(fresh.sections);
      },
      bodyApi: pagesBodyApi
    });
    document.getElementById('cmsEdSlug')?.addEventListener('input', () => {
      slugManual = true;
    });
  }

  async function openPageById(id) {
    try {
      const data = await apiGet('cmsPage', { id, hydrate: 1, persist: 0, force: 0 });
      if (data.page) openEditor(data.page);
    } catch (e) {
      notify(humanizeError(e), 'error');
    }
  }

  async function loadView(view = 'all') {
    const el = root();
    if (!el) return;
    window.CutupContentTable?.destroy?.();
    window.CutupContentEditor?.destroy?.();
    const v = String(view || 'all').toLowerCase();
    if (v === 'categories' || v === 'tags') {
      window.CutupTaxonomyManager.renderTaxonomyManager({
        container: el,
        type: 'pages',
        kind: v
      });
      return;
    }
    if (v === 'add') {
      openEditor(null);
      return;
    }
    return load();
  }

  async function load() {
    const el = root();
    if (!el) return;
    el.innerHTML = '<div class="cs-skeleton"></div>';
    try {
      showTable();
    } catch (e) {
      if (CS().isSetupError?.(e)) {
        CS().renderSetupState(el, {
          missingTables: e.payload?.missingTables,
          onRetry: () => load()
        });
        return;
      }
      el.innerHTML = `<div class="cs-empty"><h3>Could not load pages</h3><p>${esc(CS().friendlyApiMessage?.({ message: e.message }) || 'Please try again.')}</p></div>`;
    }
  }

  function destroy() {
    window.CutupContentTable?.destroy?.();
    window.CutupContentEditor?.destroy?.();
    pageBlocks = [];
    slugManual = false;
  }

  return { load, loadView, destroy, openEditor, openPageById };
})();
