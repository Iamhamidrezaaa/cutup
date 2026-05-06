/**
 * Content Studio — Blog (unified CMS table + editor)
 */
window.CutupContentBlog = (function () {
  const CS = () => window.CutupContentStudio;
  const esc = (s) => CS().esc(s);

  let slugManual = false;
  let contentHtmlTouched = false;

  function root() {
    return document.getElementById('contentBlogWorkspace');
  }

  const postsBodyApi = {
    mount(host, post) {
      cachedPost = post;
      host.innerHTML = `
        <div class="cms-field-title"><input id="cmsPostTitle" placeholder="Post title" value="${esc(post?.title || '')}" /></div>
        <label class="cms-field-block">Excerpt<textarea id="cmsPostExcerpt" rows="2" placeholder="Short summary for listings and SEO">${esc(post?.excerpt || '')}</textarea></label>
        <label class="cms-field-block">Content<textarea id="cmsPostContent" class="cms-post-content" rows="14" placeholder="Write your article…">${esc(post?.content || '')}</textarea></label>`;
      document.getElementById('cmsPostTitle')?.addEventListener('input', (ev) => {
        if (!slugManual) {
          const s = document.getElementById('cmsEdSlug');
          if (s) s.value = CS().slugify(ev.target.value);
        }
      });
      document.getElementById('cmsPostContent')?.addEventListener('input', () => {
        contentHtmlTouched = true;
        window.CutupContentEditor?.markDirty?.();
      });
      document.getElementById('cmsPostExcerpt')?.addEventListener('input', () => {
        window.CutupContentEditor?.markDirty?.();
      });
    },
    readTitle() {
      return document.getElementById('cmsPostTitle')?.value?.trim() || '';
    },
    read() {
      return {
        title: document.getElementById('cmsPostTitle')?.value?.trim() || '',
        excerpt: document.getElementById('cmsPostExcerpt')?.value?.trim() || '',
        content: document.getElementById('cmsPostContent')?.value || '',
        contentHtml:
          !contentHtmlTouched &&
          postHasHtml()
            ? lastPostHtml()
            : ''
      };
    },
    fill(post) {
      contentHtmlTouched = false;
      cachedPost = post;
    }
  };

  let cachedPost = null;
  function postHasHtml() {
    return cachedPost?.contentHtml != null && String(cachedPost.contentHtml).trim() !== '';
  }
  function lastPostHtml() {
    return cachedPost?.contentHtml || '';
  }

  function showTable() {
    window.CutupContentEditor?.destroy?.();
    const el = root();
    if (!el) return;
    window.CutupContentTable.renderContentTable({
      container: el,
      type: 'posts',
      onEdit: (item) => openEditor(item),
      onAdd: () => openEditor(null)
    });
  }

  async function openEditor(post) {
    window.CutupContentTable?.destroy?.();
    let data = post;
    if (post?.id && !post.content && !post.title) {
      data = (await window.CutupContentConfig.get('posts').fetchOne(post.id)) || post;
    }
    if (!data) {
      data = { status: 'draft', tags: [], content: '', excerpt: '' };
    }
    cachedPost = data;
    slugManual = Boolean(data.id);
    contentHtmlTouched = false;
    window.CutupContentEditor.renderContentEditor({
      container: root(),
      type: 'posts',
      item: data,
      onBack: () => showTable(),
      onSaved: (fresh) => {
        cachedPost = fresh;
      },
      bodyApi: postsBodyApi
    });
    document.getElementById('cmsEdSlug')?.addEventListener('input', () => {
      slugManual = true;
    });
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
        type: 'posts',
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
      el.innerHTML = `<div class="cs-empty"><h3>Could not load blog</h3><p>${esc(CS().humanizeError(e))}</p></div>`;
    }
  }

  function destroy() {
    window.CutupContentTable?.destroy?.();
    window.CutupContentEditor?.destroy?.();
    cachedPost = null;
    slugManual = false;
    contentHtmlTouched = false;
  }

  return { load, loadView, destroy, openEditor };
})();
