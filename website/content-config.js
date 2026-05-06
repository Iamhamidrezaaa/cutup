/**
 * Unified CMS — content-type configuration (Pages / Posts).
 */
window.CutupContentConfig = (function () {
  const CS = () => window.CutupContentStudio;

  function pageSeoScore(p) {
    let n = 0;
    if ((p.metaTitle || '').length >= 20) n += 40;
    if ((p.metaDescription || '').length >= 60) n += 40;
    if (p.ogImageUrl) n += 20;
    return Math.min(100, n);
  }

  function postSeoScore(p) {
    const content = String(p.content || '');
    const excerpt = String(p.excerpt || '');
    const meta = String(p.metaTitle || p.seoTitle || '');
    const cover = String(p.coverImageUrl || '');
    let score = 0;
    if (content.split(/\s+/).filter(Boolean).length >= 800) score += 25;
    if ((content.match(/^##\s/gm) || []).length >= 3) score += 20;
    if (/blog\.html\?slug=|cutup\.shop/i.test(content)) score += 15;
    if (excerpt.length >= 120) score += 15;
    if (meta.length >= 50) score += 15;
    if (cover) score += 10;
    return Math.min(100, score);
  }

  function toRowPages(p) {
    return {
      id: String(p.id),
      title: p.title || 'Untitled',
      slug: p.slug || '',
      status: p.status || 'draft',
      author: p.updatedBy || p.publishedBy || '—',
      category: p.template || 'default',
      tags: [],
      tagsLabel: '—',
      seoScore: pageSeoScore(p),
      updatedAt: p.updatedAt,
      thumbnailUrl: p.ogImageUrl || '',
      isProtected: Boolean(p.isSystem),
      isHomepage: Boolean(p.isHomepage),
      raw: p
    };
  }

  function toRowPosts(p) {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    return {
      id: String(p.id),
      title: p.title || 'Untitled',
      slug: p.slug || '',
      status: p.status || 'draft',
      author: p.authorEmail || p.updatedBy || '—',
      category: p.category || '—',
      tags,
      tagsLabel: tags.length ? tags.join(', ') : '—',
      seoScore: postSeoScore(p),
      updatedAt: p.updatedAt,
      thumbnailUrl: p.coverImageUrl || '',
      isProtected: false,
      isHomepage: false,
      raw: p
    };
  }

  const TYPES = {
    pages: {
      key: 'pages',
      label: 'Page',
      labelPlural: 'Pages',
      workspaceId: 'contentPagesWorkspace',
      navSection: 'pages',
      toRow: toRowPages,
      async fetchItems(opts = {}) {
        const trash = Boolean(opts.trash);
        const data = await CS().apiGet('cmsPages', trash ? { trash: 1 } : {});
        return (data.pages || []).map(toRowPages);
      },
      async fetchOne(id, opts = {}) {
        const data = await CS().apiGet('cmsPage', {
          id,
          hydrate: opts.hydrate !== 0 ? 1 : 0,
          persist: opts.persist === 1 ? 1 : 0,
          force: opts.force === 1 ? 1 : 0
        });
        if (data.hydrationDebug) window.CutupCmsHydration?.mergeServerDebug?.(data.hydrationDebug);
        return data.page || null;
      },
      async save(item, publish) {
        const payload = { ...item };
        if (publish) payload.status = 'published';
        const res = await CS().apiPost('saveCmsPage', payload);
        return res.id;
      },
      async duplicate(id) {
        const res = await CS().apiPost('duplicateCmsPage', { id });
        return res.id;
      },
      async softDelete(id) {
        await CS().apiPost('deleteCmsPage', { id });
      },
      async restore(id) {
        await CS().apiPost('restoreCmsPage', { id });
      },
      async purge(id) {
        await CS().apiPost('purgeCmsPage', { id });
      },
      previewUrl(item) {
        const slug = item.slug || item.raw?.slug;
        if (!slug) return null;
        return slug === 'home' ? '/' : `/${slug}.html`;
      },
      quickEditFields: ['title', 'slug', 'status', 'category'],
      statusOptions: ['draft', 'published', 'scheduled', 'archived'],
      categoryLabel: 'Template',
      categoryOptions: ['default', 'landing', 'legal']
    },
    posts: {
      key: 'posts',
      label: 'Post',
      labelPlural: 'Posts',
      workspaceId: 'contentBlogWorkspace',
      navSection: 'blog',
      toRow: toRowPosts,
      async fetchItems(opts = {}) {
        const trash = Boolean(opts.trash);
        try {
          const data = await CS().apiGet('blogPostsEnriched', trash ? { trash: 1 } : {});
          return (data.posts || []).map(toRowPosts);
        } catch {
          const data = await CS().apiGet('blogPosts');
          const raw = data.posts || [];
          const filtered = trash
            ? raw.filter((p) => p.status === 'trash' || p.status === 'deleted')
            : raw.filter((p) => p.status !== 'trash' && p.status !== 'deleted');
          return filtered.map(toRowPosts);
        }
      },
      async fetchOne(id) {
        const items = await TYPES.posts.fetchItems({ trash: false });
        const hit = items.find((r) => String(r.id) === String(id));
        return hit?.raw || null;
      },
      async save(item, publish) {
        const payload = { ...item };
        if (publish) payload.status = 'published';
        try {
          const res = await CS().apiPost('saveBlogPostEnriched', payload);
          return res.id;
        } catch {
          const res = await CS().apiPost('saveBlogPost', {
            id: payload.id,
            slug: payload.slug,
            title: payload.title,
            excerpt: payload.excerpt,
            content: payload.content,
            status: payload.status === 'published' ? 'published' : 'draft',
            category: payload.category,
            tags: payload.tags,
            metaTitle: payload.seoTitle || payload.metaTitle,
            metaDescription: payload.metaDescription,
            canonicalUrl: payload.canonicalUrl,
            ogTitle: payload.ogTitle,
            ogDescription: payload.ogDescription,
            coverImageUrl: payload.coverImageUrl
          });
          return res.id;
        }
      },
      async duplicate(id) {
        const res = await CS().apiPost('duplicateBlogPost', { id });
        return res.id;
      },
      async softDelete(id) {
        await CS().apiPost('softDeleteBlogPost', { id });
      },
      async restore(id) {
        await CS().apiPost('restoreBlogPost', { id });
      },
      async purge(id) {
        await CS().apiPost('purgeBlogPost', { id });
      },
      previewUrl(item) {
        const slug = item.slug || item.raw?.slug;
        if (!slug) return null;
        return `/blog/${encodeURIComponent(slug)}`;
      },
      quickEditFields: ['title', 'slug', 'status', 'category', 'tags'],
      statusOptions: ['draft', 'published', 'scheduled', 'archived'],
      categoryLabel: 'Category',
      categoryOptions: null
    }
  };

  function get(type) {
    const key = type === 'pages' ? 'pages' : type === 'posts' ? 'posts' : type;
    return TYPES[key] || null;
  }

  return { get, TYPES };
})();
