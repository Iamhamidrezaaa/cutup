const API_BASE_URL = 'https://cutup.shop';
const BLOG_ENDPOINT = `${API_BASE_URL}/api/admin?action=blogPosts&public=1`;
const ARTICLE_CTA_URL = 'https://cutup.shop/#tool';

let postsCache = [];
let tocScrollCleanup = null;

const STICKY_CTA_SCROLL_SHOW_RATIO = 0.25;
const STICKY_CTA_TOP_HIDE_PX = 48;
let stickyArticleCtaRaf = null;
let stickyArticleCtaOnScroll = null;
let stickyArticleCtaOnResize = null;
let stickyArticleCtaVisible = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

function q(sel) { return document.querySelector(sel); }

function setMetaByName(name, content) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setMetaByProperty(prop, content) {
  if (!content) return;
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', prop);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(url) {
  if (!url) return;
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
}

function renderEmptyState(message = 'No articles yet. Check back soon.') {
  const grid = q('#blogGrid');
  if (!grid) return;
  grid.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function hydrateFilters(posts) {
  const categoryFilter = q('#categoryFilter');
  const tagFilter = q('#tagFilter');
  if (!categoryFilter || !tagFilter) return;
  const categories = [...new Set(posts.map((p) => String(p.category || '').trim()).filter(Boolean))].sort();
  const tags = [...new Set(posts.flatMap((p) => normalizeTags(p.tags)))].sort();
  categoryFilter.innerHTML = `<option value="all">All categories</option>${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
  tagFilter.innerHTML = `<option value="all">All tags</option>${tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}`;
}

function getFilteredPosts(posts) {
  const search = String(q('#searchInput')?.value || '').trim().toLowerCase();
  const category = String(q('#categoryFilter')?.value || 'all');
  const tag = String(q('#tagFilter')?.value || 'all');
  return posts.filter((p) => {
    const title = String(p.title || '').toLowerCase();
    const content = String(p.content || '').toLowerCase();
    const excerpt = String(p.excerpt || '').toLowerCase();
    const matchesSearch = !search || title.includes(search) || content.includes(search) || excerpt.includes(search);
    const matchesCategory = category === 'all' || String(p.category || '') === category;
    const tags = normalizeTags(p.tags);
    const matchesTag = tag === 'all' || tags.includes(tag);
    return matchesSearch && matchesCategory && matchesTag;
  });
}

function postCardMarkup(post, { related = false } = {}) {
  const tags = normalizeTags(post.tags);
  const date = post.publishedAt || post.updatedAt;
  const cover = sanitizeImageUrl(post.coverImageUrl || '');
  const cat = String(post.category || '').trim();
  const placeholderLabel = cat || 'Article';
  const title = post.title || 'Untitled';
  const slugQ = encodeURIComponent(post.slug || '');
  const thumb = cover
    ? `<img class="post-card-thumb" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">`
    : '';
  const extraClasses = related ? ' post-card--related' : '';
  const excerptBlock = related
    ? ''
    : `<p class="post-excerpt">${escapeHtml(post.excerpt || 'No excerpt provided yet.')}</p>
      <div class="post-meta-line">
        ${tags.slice(0, 4).map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join('')}
      </div>`;
  const metaLine = related
    ? `<div class="post-meta-line"><span>${escapeHtml(fmtDate(date))}</span></div>`
    : `<div class="post-meta-line">
        ${cat ? `<span class="pill">${escapeHtml(cat)}</span>` : ''}
        <span>${escapeHtml(fmtDate(date))}</span>
      </div>`;
  return `
    <article class="post-card${extraClasses}">
      <a class="post-card-media" href="blog.html?slug=${slugQ}" aria-label="${escapeHtml(title)}">
        ${thumb}
        <div class="post-card-placeholder"><span>${escapeHtml(placeholderLabel)}</span></div>
      </a>
      ${metaLine}
      <h2><a href="blog.html?slug=${slugQ}">${escapeHtml(title)}</a></h2>
      ${excerptBlock}
      <a class="read-more" href="blog.html?slug=${slugQ}">Read more</a>
    </article>
  `;
}

function wirePostCardThumbs(root) {
  root?.querySelectorAll('.post-card-thumb').forEach((img) => {
    img.addEventListener('error', () => {
      img.classList.add('post-card-thumb--broken');
    });
  });
}

function renderList(posts) {
  const grid = q('#blogGrid');
  if (!grid) return;
  if (!posts.length) return renderEmptyState();
  grid.innerHTML = posts.map(postCardMarkup).join('');
  wirePostCardThumbs(grid);
}

function buildCtaCard() {
  const wrap = document.createElement('aside');
  wrap.className = 'post-cta';
  wrap.setAttribute('aria-label', 'Promotional call to action');
  const titleEl = document.createElement('p');
  titleEl.className = 'post-cta-title';
  titleEl.textContent = 'Turn your video into subtitles in seconds';
  const btn = document.createElement('a');
  btn.className = 'post-cta-btn';
  const safeHref = sanitizeUrl(ARTICLE_CTA_URL);
  btn.href = safeHref || ARTICLE_CTA_URL;
  btn.textContent = 'Try it now';
  try {
    const u = new URL(btn.href, window.location.href);
    if (u.origin !== window.location.origin) {
      btn.target = '_blank';
      btn.rel = 'noopener noreferrer';
    }
  } catch {
    /* keep defaults */
  }
  wrap.append(titleEl, btn);
  return wrap;
}

function rawArticleHasCtaSignals(markdown) {
  const s = String(markdown || '');
  return s.includes('cutup.shop') || s.includes('#tool');
}

function injectArticleCtas(contentEl, rawMarkdown) {
  if (!contentEl) return;
  if (rawArticleHasCtaSignals(rawMarkdown)) return;

  const paragraphs = [...contentEl.querySelectorAll(':scope > p')];
  const cta = buildCtaCard();
  if (paragraphs.length >= 2) {
    paragraphs[1].insertAdjacentElement('afterend', cta);
  } else if (paragraphs.length === 1) {
    paragraphs[0].insertAdjacentElement('afterend', cta);
  } else {
    contentEl.appendChild(cta);
  }
}

function pickRelatedPosts(current, allPosts, limit = 3) {
  const slug = String(current.slug || '');
  const cat = String(current.category || '').trim();
  const others = allPosts.filter((p) => String(p.slug || '') !== slug);
  const sameCat = cat ? others.filter((p) => String(p.category || '').trim() === cat) : [];
  const picked = [];
  for (const p of sameCat) {
    if (picked.length >= limit) break;
    picked.push(p);
  }
  for (const p of others) {
    if (picked.length >= limit) break;
    if (picked.includes(p)) continue;
    picked.push(p);
  }
  return picked.slice(0, limit);
}

function renderRelatedPostsGrid(current, allPosts) {
  const section = q('#relatedSection');
  const grid = q('#relatedGrid');
  if (!section || !grid) return;
  const related = pickRelatedPosts(current, allPosts, 3);
  if (!related.length) {
    section.hidden = true;
    grid.innerHTML = '';
    return;
  }
  section.hidden = false;
  grid.innerHTML = related.map((p) => postCardMarkup(p, { related: true })).join('');
  wirePostCardThumbs(grid);
}

function getDocumentScrollRatio() {
  const root = document.documentElement;
  const scrollTop = window.scrollY ?? root.scrollTop ?? 0;
  const viewport = root.clientHeight || window.innerHeight || 1;
  const scrollable = Math.max(0, root.scrollHeight - viewport);
  if (scrollable <= 0) return 0;
  return Math.min(1, scrollTop / scrollable);
}

function syncStickyArticleCtaButton(bar) {
  const btn = bar?.querySelector?.('.sticky-article-cta__btn');
  if (!btn) return;
  const safe = sanitizeUrl(ARTICLE_CTA_URL) || ARTICLE_CTA_URL;
  btn.setAttribute('href', safe);
  try {
    const u = new URL(btn.href, window.location.href);
    if (u.origin !== window.location.origin) {
      btn.target = '_blank';
      btn.rel = 'noopener noreferrer';
    } else {
      btn.removeAttribute('target');
      btn.removeAttribute('rel');
    }
  } catch {
    btn.removeAttribute('target');
    btn.removeAttribute('rel');
  }
}

function teardownStickyArticleCta() {
  if (stickyArticleCtaRaf != null) {
    cancelAnimationFrame(stickyArticleCtaRaf);
    stickyArticleCtaRaf = null;
  }
  if (stickyArticleCtaOnScroll) {
    window.removeEventListener('scroll', stickyArticleCtaOnScroll);
    stickyArticleCtaOnScroll = null;
  }
  if (stickyArticleCtaOnResize) {
    window.removeEventListener('resize', stickyArticleCtaOnResize);
    stickyArticleCtaOnResize = null;
  }
  stickyArticleCtaVisible = false;
  document.body.classList.remove('has-sticky-article-cta--visible');
  const bar = q('#stickyArticleCta');
  if (bar) {
    bar.classList.remove('is-visible');
    bar.hidden = true;
    bar.setAttribute('aria-hidden', 'true');
  }
}

function setupStickyArticleCta() {
  teardownStickyArticleCta();
  const bar = q('#stickyArticleCta');
  if (!bar) return;
  syncStickyArticleCtaButton(bar);
  bar.hidden = false;
  bar.setAttribute('aria-hidden', 'true');
  bar.classList.remove('is-visible');

  const applyVisibility = () => {
    const y = window.scrollY ?? document.documentElement.scrollTop ?? 0;
    const ratio = getDocumentScrollRatio();
    if (y < STICKY_CTA_TOP_HIDE_PX) {
      stickyArticleCtaVisible = false;
    } else if (ratio >= STICKY_CTA_SCROLL_SHOW_RATIO) {
      stickyArticleCtaVisible = true;
    }
    const show = stickyArticleCtaVisible;
    bar.classList.toggle('is-visible', show);
    bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    document.body.classList.toggle('has-sticky-article-cta--visible', show);
  };

  const schedule = () => {
    if (stickyArticleCtaRaf != null) return;
    stickyArticleCtaRaf = requestAnimationFrame(() => {
      stickyArticleCtaRaf = null;
      applyVisibility();
    });
  };

  stickyArticleCtaOnScroll = schedule;
  stickyArticleCtaOnResize = schedule;
  window.addEventListener('scroll', stickyArticleCtaOnScroll, { passive: true });
  window.addEventListener('resize', stickyArticleCtaOnResize, { passive: true });
  schedule();
}

function teardownTocScroll() {
  if (typeof tocScrollCleanup === 'function') {
    tocScrollCleanup();
    tocScrollCleanup = null;
  }
}

function bindTocScrollSpy(tocRoot, postContent) {
  teardownTocScroll();
  if (!tocRoot || !postContent) return;
  const links = [...tocRoot.querySelectorAll('a.post-toc-link[href^="#"]')];
  const headings = [...postContent.querySelectorAll('h1[id], h2[id], h3[id]')];
  if (!links.length || !headings.length) return;

  const setActive = (id) => {
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      const target = href.startsWith('#') ? href.slice(1) : '';
      a.classList.toggle('is-active', Boolean(id) && target === id);
    });
  };

  const scrollOffset = 96;
  const onScroll = () => {
    let current = headings[0]?.id || '';
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= scrollOffset) current = h.id;
    }
    setActive(current);
  };

  const onClick = (e) => {
    const a = e.target.closest('a.post-toc-link');
    if (!a || !tocRoot.contains(a)) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    const id = decodeURIComponent(href.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el || !postContent.contains(el)) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  tocRoot.addEventListener('click', onClick);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  tocScrollCleanup = () => {
    tocRoot.removeEventListener('click', onClick);
    window.removeEventListener('scroll', onScroll);
  };
}

function slugifyHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || `section-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') || raw.startsWith('#')) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/** Cover / OG images: http(s) only — blocks javascript:, data:, etc. */
function sanitizeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function removeMetaNode(selector) {
  document.querySelector(selector)?.remove();
}

function upsertJsonLd(id, payload) {
  if (!payload) return;
  let script = document.querySelector(`script[data-jsonld="${id}"]`);
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-jsonld', id);
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
}

function removeJsonLd(id) {
  document.querySelector(`script[data-jsonld="${id}"]`)?.remove();
}

function parseInlineMarkdown(text) {
  let out = escapeHtml(text || '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = sanitizeUrl(href);
    if (!safeHref) return escapeHtml(label);
    const isExternal = /^https?:\/\//i.test(safeHref);
    const rel = isExternal ? ' rel="noopener noreferrer nofollow"' : '';
    const target = isExternal ? ' target="_blank"' : '';
    return `<a href="${escapeHtml(safeHref)}"${target}${rel}>${escapeHtml(label)}</a>`;
  });
  return out;
}

function renderArticleContent(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const parts = [];
  const toc = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      parts.push('</ul>');
      inList = false;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }
    if (/^###\s+/.test(trimmed)) {
      closeList();
      const text = trimmed.replace(/^###\s+/, '');
      const id = slugifyHeading(text.replace(/\*\*([^*]+)\*\*/g, '$1'));
      toc.push({ id, label: text });
      parts.push(`<h3 id="${escapeHtml(id)}">${parseInlineMarkdown(text)}</h3>`);
      return;
    }
    if (/^##\s+/.test(trimmed)) {
      closeList();
      const text = trimmed.replace(/^##\s+/, '');
      const id = slugifyHeading(text.replace(/\*\*([^*]+)\*\*/g, '$1'));
      toc.push({ id, label: text });
      parts.push(`<h2 id="${escapeHtml(id)}">${parseInlineMarkdown(text)}</h2>`);
      return;
    }
    if (/^#\s+/.test(trimmed)) {
      closeList();
      const text = trimmed.replace(/^#\s+/, '');
      const id = slugifyHeading(text.replace(/\*\*([^*]+)\*\*/g, '$1'));
      toc.push({ id, label: text });
      parts.push(`<h1 id="${escapeHtml(id)}">${parseInlineMarkdown(text)}</h1>`);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        parts.push('<ul>');
        inList = true;
      }
      parts.push(`<li>${parseInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      return;
    }
    closeList();
    parts.push(`<p>${parseInlineMarkdown(trimmed)}</p>`);
  });
  closeList();
  return { html: parts.join(''), toc };
}

function setSeoForPost(post) {
  const slug = encodeURIComponent(post.slug || '');
  const pageUrl = `${window.location.origin}/blog.html?slug=${slug}`;
  const title = post.metaTitle || post.title || 'Cutup Blog';
  const description = post.metaDescription || post.excerpt || `Read "${post.title || 'this article'}" on Cutup Blog.`;
  document.title = title;
  setMetaByName('description', description);
  setMetaByProperty('og:title', post.ogTitle || title);
  setMetaByProperty('og:description', post.ogDescription || description);
  setMetaByProperty('og:url', pageUrl);
  setCanonical(post.canonicalUrl || pageUrl);
  const ogImg = sanitizeImageUrl(post.coverImageUrl || '');
  if (ogImg) {
    setMetaByProperty('og:image', ogImg);
    setMetaByName('twitter:image', ogImg);
    setMetaByName('twitter:card', 'summary_large_image');
  } else {
    removeMetaNode('meta[property="og:image"]');
    removeMetaNode('meta[name="twitter:image"]');
    removeMetaNode('meta[name="twitter:image:src"]');
    setMetaByName('twitter:card', 'summary');
  }
  removeJsonLd('blog');
  upsertJsonLd('blog-posting', {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title || 'Cutup Blog',
    description,
    datePublished: post.publishedAt || post.updatedAt || undefined,
    dateModified: post.updatedAt || post.publishedAt || undefined,
    author: {
      '@type': 'Organization',
      name: 'Cutup'
    },
    image: ogImg || undefined,
    url: pageUrl,
    mainEntityOfPage: pageUrl
  });
}

function setSeoForList() {
  const pageUrl = `${window.location.origin}/blog.html`;
  document.title = 'Cutup Blog';
  setMetaByName('description', 'Insights, tutorials, and product updates from Cutup.');
  setMetaByProperty('og:title', 'Cutup Blog');
  setMetaByProperty('og:description', 'Insights, tutorials, and product updates from Cutup.');
  setMetaByProperty('og:url', pageUrl);
  setCanonical(pageUrl);
  removeMetaNode('meta[property="og:image"]');
  removeMetaNode('meta[name="twitter:image"]');
  removeMetaNode('meta[name="twitter:image:src"]');
  setMetaByName('twitter:card', 'summary');
  removeJsonLd('blog-posting');
  upsertJsonLd('blog', {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Cutup Blog',
    url: pageUrl,
    description: 'Insights, tutorials, and product updates from Cutup.',
    publisher: {
      '@type': 'Organization',
      name: 'Cutup'
    }
  });
}

function renderPost(post) {
  const listView = q('#blogListView');
  const postView = q('#blogPostView');
  if (!listView || !postView) return;
  listView.hidden = true;
  postView.hidden = false;

  const postTitle = post.title || 'Untitled';
  q('#postTitle').textContent = postTitle;
  const coverEl = q('#postCoverImage');
  const coverUrl = sanitizeImageUrl(post.coverImageUrl || '');
  if (coverEl) {
    coverEl.onerror = null;
    coverEl.onload = null;
    if (coverUrl) {
      coverEl.hidden = false;
      coverEl.alt = postTitle;
      coverEl.onerror = () => {
        coverEl.hidden = true;
        coverEl.removeAttribute('src');
        coverEl.alt = '';
      };
      coverEl.src = coverUrl;
    } else {
      coverEl.hidden = true;
      coverEl.removeAttribute('src');
      coverEl.alt = '';
    }
  }
  const date = fmtDate(post.publishedAt || post.updatedAt);
  const tags = normalizeTags(post.tags);
  q('#postMeta').innerHTML = `
    <span>${escapeHtml(date)}</span>
    ${post.category ? `<span class="pill">${escapeHtml(post.category)}</span>` : ''}
    ${tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join('')}
  `;

  const rawPostBody = post.content || '';
  const parsed = renderArticleContent(rawPostBody);
  const contentEl = q('#postContent');
  contentEl.innerHTML = parsed.html || '<p>No content available.</p>';
  injectArticleCtas(contentEl, rawPostBody);

  const tocEl = q('#postToc');
  if (parsed.toc.length) {
    tocEl.innerHTML = `
      <p class="post-toc-title">On this page</p>
      ${parsed.toc.map((item) => `<a class="post-toc-link" href="#${escapeHtml(item.id)}">${escapeHtml(item.label)}</a>`).join('')}
    `;
  } else {
    tocEl.innerHTML = `<p class="post-toc-title">On this page</p><span>No sections</span>`;
  }

  teardownTocScroll();
  if (parsed.toc.length) bindTocScrollSpy(tocEl, contentEl);

  renderRelatedPostsGrid(post, postsCache);

  setSeoForPost(post);

  setupStickyArticleCta();
}

async function loadPosts() {
  const response = await fetch(BLOG_ENDPOINT);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not load blog posts.');
  const posts = (data.posts || []).filter((p) => p.status === 'published');
  posts.sort((a, b) => {
    const da = new Date(a.publishedAt || a.updatedAt || 0).getTime();
    const db = new Date(b.publishedAt || b.updatedAt || 0).getTime();
    return db - da;
  });
  return posts;
}

function setupListInteractions() {
  const handler = () => renderList(getFilteredPosts(postsCache));
  q('#searchInput')?.addEventListener('input', handler);
  q('#categoryFilter')?.addEventListener('change', handler);
  q('#tagFilter')?.addEventListener('change', handler);
}

function setupShareButton() {
  q('#copyLinkBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      q('#copyLinkBtn').textContent = 'Link copied';
      setTimeout(() => { q('#copyLinkBtn').textContent = 'Copy article link'; }, 1800);
    } catch {
      q('#copyLinkBtn').textContent = 'Could not copy';
      setTimeout(() => { q('#copyLinkBtn').textContent = 'Copy article link'; }, 1800);
    }
  });
}

async function bootstrap() {
  setupShareButton();
  const listView = q('#blogListView');
  const postView = q('#blogPostView');
  if (!listView || !postView) return;
  teardownTocScroll();
  teardownStickyArticleCta();
  q('#blogGrid').innerHTML = '<div class="empty-state">Loading articles...</div>';
  try {
    postsCache = await loadPosts();
    const slug = new URLSearchParams(window.location.search).get('slug');
    if (slug) {
      const post = postsCache.find((p) => String(p.slug || '') === slug);
      if (post) {
        renderPost(post);
      } else {
        setSeoForList();
        postView.hidden = true;
        listView.hidden = false;
        q('#relatedSection')?.setAttribute('hidden', '');
        teardownStickyArticleCta();
        renderEmptyState('Article not found. Check back on the blog list.');
      }
      return;
    }
    setSeoForList();
    q('#relatedSection')?.setAttribute('hidden', '');
    hydrateFilters(postsCache);
    setupListInteractions();
    renderList(postsCache);
  } catch (_e) {
    setSeoForList();
    q('#relatedSection')?.setAttribute('hidden', '');
    renderEmptyState('No articles yet. Check back soon.');
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
