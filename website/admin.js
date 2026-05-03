const API_BASE_URL = 'https://cutup.shop';
let currentSession = null;
let currentUser = null;
let blogPostsCache = [];
let slugManuallyEdited = false;

const MD_CTA_TEXT = 'Try it now — paste your video and generate subtitles in seconds.\nhttps://cutup.shop/#tool';

const CHECKLIST_MIN_WORDS = 800;
const CHECKLIST_MIN_H23 = 3;
const INTERNAL_HOST_RE = /cutup\.shop/i;
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/;
const INTERNAL_SUGGEST_MAX_LINKS = 3;
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from', 'by', 'for', 'with',
  'about', 'into', 'through', 'during', 'before', 'after', 'under', 'again', 'further', 'once', 'here', 'there',
  'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'same', 'than', 'too', 'very', 'just',
  'also', 'not', 'no', 'in', 'on', 'to', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'does', 'did', 'doing', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'will',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'its', 'our', 'your', 'their', 'they',
  'them', 'we', 'you', 'he', 'she', 'it', 'my', 'me', 'him', 'her', 'us', 'of', 'as', 'any', 'both', 'per',
  'via', 'how', 'why', 'where', 'well', 'back', 'down', 'out', 'off', 'over', 'such', 'than', 'then', 'them',
  'very', 'was', 'were', 'what', 'when', 'which', 'while', 'with', 'have', 'your', 'make', 'made', 'many',
  'much', 'like', 'know', 'just', 'get', 'got', 'new', 'now', 'old', 'see', 'two', 'way', 'use', 'used',
  'want', 'work', 'year', 'day', 'one', 'two', 'into', 'onto', 'upon', 'near', 'next', 'still', 'even',
  'ever', 'never', 'both', 'each', 'every', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'don', 'doesn'
]);

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusBadge(text, kind = 'neutral') {
  const cls = kind === 'ok' ? 'badge-ok'
    : kind === 'warn' ? 'badge-warn'
      : kind === 'err' ? 'badge-err'
        : 'badge-neutral';
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function emptyRow(colspan, message) {
  return `<tr><td class="empty-row" colspan="${colspan}">${escapeHtml(message)}</td></tr>`;
}

/** Allow only http(s) for cover images (blocks javascript:, data:, etc.). */
function sanitizeAdminCoverUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function updateCoverPreview() {
  const input = document.getElementById('postCoverImageUrl');
  const wrap = document.getElementById('coverPreviewWrap');
  const img = document.getElementById('coverPreviewImg');
  const hint = document.getElementById('coverUrlHint');
  const fallback = document.getElementById('coverPreviewFallback');
  if (!input || !wrap || !img || !hint) return;
  const raw = input.value.trim();
  hint.hidden = true;
  hint.textContent = '';
  img.style.display = '';
  if (fallback) fallback.hidden = true;
  if (!raw) {
    wrap.hidden = true;
    img.removeAttribute('src');
    return;
  }
  const safe = sanitizeAdminCoverUrl(raw);
  if (!safe) {
    hint.textContent = 'Use a full https://… image URL. Other schemes are not allowed.';
    hint.hidden = false;
    wrap.hidden = true;
    img.removeAttribute('src');
    return;
  }
  wrap.hidden = false;
  img.alt = 'Cover preview';
  img.onerror = () => {
    img.style.display = 'none';
    if (fallback) fallback.hidden = false;
    hint.textContent = 'Image failed to load — check the URL.';
    hint.hidden = false;
  };
  img.onload = () => {
    img.style.display = '';
    if (fallback) fallback.hidden = true;
    hint.hidden = true;
  };
  img.src = safe;
}

function slugifyTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function evaluateLengthState(length, min, max) {
  if (length === 0) return { label: `${length} chars`, cls: '' };
  if (length < min) return { label: `${length} chars • too short`, cls: 'counter-short' };
  if (length > max) return { label: `${length} chars • too long`, cls: 'counter-long' };
  return { label: `${length} chars • good`, cls: 'counter-good' };
}

function updateCharCounter(counterId, inputId, min, max) {
  const counter = document.getElementById(counterId);
  const input = document.getElementById(inputId);
  if (!counter || !input) return;
  const state = evaluateLengthState(String(input.value || '').trim().length, min, max);
  counter.textContent = state.label;
  counter.classList.remove('counter-short', 'counter-good', 'counter-long');
  if (state.cls) counter.classList.add(state.cls);
}

function updateSeoCounters() {
  updateCharCounter('metaTitleCounter', 'postMetaTitle', 50, 60);
  updateCharCounter('metaDescriptionCounter', 'postMetaDescription', 140, 160);
  updateCharCounter('excerptCounter', 'postExcerpt', 120, 160);
}

function sanitizeUrlForMarkdown(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, window.location.origin);
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return '';
    return u.href;
  } catch {
    return '';
  }
}

function parseInlineMarkdownAdmin(text) {
  let out = escapeHtml(text || '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = sanitizeUrlForMarkdown(href);
    if (!safeHref) return escapeHtml(label);
    const isExternal = /^https?:\/\//i.test(safeHref);
    const rel = isExternal ? ' rel="noopener noreferrer nofollow"' : '';
    const target = isExternal ? ' target="_blank"' : '';
    return `<a href="${escapeHtml(safeHref)}"${target}${rel}>${escapeHtml(label)}</a>`;
  });
  return out;
}

function renderMarkdownPreview(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const parts = [];
  let inUl = false;
  let inOl = false;
  let paragraph = [];

  const closeLists = () => {
    if (inUl) { parts.push('</ul>'); inUl = false; }
    if (inOl) { parts.push('</ol>'); inOl = false; }
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    closeLists();
    parts.push(`<p>${parseInlineMarkdownAdmin(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      return;
    }
    if (/^###\s+/.test(trimmed)) {
      flushParagraph();
      parts.push(`<h3>${parseInlineMarkdownAdmin(trimmed.replace(/^###\s+/, ''))}</h3>`);
      return;
    }
    if (/^##\s+/.test(trimmed)) {
      flushParagraph();
      parts.push(`<h2>${parseInlineMarkdownAdmin(trimmed.replace(/^##\s+/, ''))}</h2>`);
      return;
    }
    if (/^#\s+/.test(trimmed)) {
      flushParagraph();
      parts.push(`<h1>${parseInlineMarkdownAdmin(trimmed.replace(/^#\s+/, ''))}</h1>`);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      if (inOl) { parts.push('</ol>'); inOl = false; }
      if (!inUl) { parts.push('<ul>'); inUl = true; }
      parts.push(`<li>${parseInlineMarkdownAdmin(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      return;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      if (inUl) { parts.push('</ul>'); inUl = false; }
      if (!inOl) { parts.push('<ol>'); inOl = true; }
      parts.push(`<li>${parseInlineMarkdownAdmin(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      return;
    }
    closeLists();
    paragraph.push(trimmed);
  });

  flushParagraph();
  closeLists();
  return parts.join('') || '<p class="muted">Nothing to preview yet.</p>';
}

function setEditorMode(mode = 'write') {
  const writeTab = document.getElementById('editorWriteTab');
  const previewTab = document.getElementById('editorPreviewTab');
  const content = document.getElementById('postContent');
  const preview = document.getElementById('editorPreviewPanel');
  if (!writeTab || !previewTab || !content || !preview) return;
  const isPreview = mode === 'preview';
  writeTab.classList.toggle('active', !isPreview);
  previewTab.classList.toggle('active', isPreview);
  writeTab.setAttribute('aria-selected', String(!isPreview));
  previewTab.setAttribute('aria-selected', String(isPreview));
  content.hidden = isPreview;
  preview.hidden = !isPreview;
  if (isPreview) {
    preview.innerHTML = renderMarkdownPreview(content.value || '');
  } else {
    content.focus();
  }
}

function updatePreviewIfOpen() {
  const preview = document.getElementById('editorPreviewPanel');
  const content = document.getElementById('postContent');
  if (!preview || !content || preview.hidden) return;
  preview.innerHTML = renderMarkdownPreview(content.value || '');
}

function insertAtCursor(textarea, prefix, suffix = '', placeholder = '') {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const selected = textarea.value.slice(start, end) || placeholder;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${prefix}${selected}${suffix}${after}`;
  const cursor = start + prefix.length + selected.length + suffix.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertRawAtCursor(textarea, chunk) {
  if (!textarea || chunk == null) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${chunk}${after}`;
  const cursor = start + chunk.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function countMarkdownWords(md) {
  let t = String(md || '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, ' ');
  t = t.replace(/^[-*]\s+/gm, ' ');
  t = t.replace(/^\d+\.\s+/gm, ' ');
  t = t.replace(/\*\*|__/g, ' ');
  t = t.replace(/[*_`]/g, ' ');
  t = t.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function countH2H3Headings(md) {
  const lines = String(md || '').split(/\r?\n/);
  let n = 0;
  for (const line of lines) {
    const s = line.trim();
    if (/^###\s+/.test(s)) n += 1;
    else if (/^##\s+/.test(s)) n += 1;
  }
  return n;
}

function extractMarkdownLinkTargets(md) {
  const urls = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    urls.push(String(m[2] || '').trim());
  }
  return urls;
}

function hasInternalCutupLink(urls) {
  return urls.some((u) => INTERNAL_HOST_RE.test(u));
}

function hasExternalHttpLink(urls) {
  return urls.some((u) => /^https?:\/\//i.test(u) && !INTERNAL_HOST_RE.test(u));
}

function hasCtaInMarkdown(content) {
  const s = String(content || '');
  if (/cutup\.shop[^)\s]*#tool/i.test(s)) return true;
  if (/cutup\.shop\/#tool/i.test(s)) return true;
  if (/try\s+it\s+now/i.test(s) && INTERNAL_HOST_RE.test(s)) return true;
  if (/subtitles?\s+in\s+seconds/i.test(s) && INTERNAL_HOST_RE.test(s)) return true;
  return false;
}

function extractKeywordFreq(text) {
  const freq = new Map();
  String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w))
    .forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  return freq;
}

function sortedKeywordsByWeight(freq) {
  return [...freq.entries()]
    .filter(([w]) => w.length > 4)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => w);
}

function scorePostForInternalSuggest(post, freq) {
  let score = 0;
  const title = String(post.title || '').toLowerCase();
  const slugJoined = String(post.slug || '').toLowerCase().replace(/[-_]/g, ' ');
  const slugParts = String(post.slug || '').toLowerCase().split(/[-_]/);
  for (const [w, c] of freq) {
    if (w.length <= 4) continue;
    if (title.includes(w)) score += c * 4;
    if (slugJoined.includes(w)) score += c * 3;
    if (slugParts.some((p) => p === w)) score += c * 2;
  }
  return score;
}

function findMatchedPhrase(post, keywordsSorted) {
  const title = String(post.title || '');
  const titleLower = title.toLowerCase();
  const slug = String(post.slug || '').toLowerCase();
  for (const kw of keywordsSorted) {
    const idx = titleLower.indexOf(kw);
    if (idx !== -1) return title.slice(idx, idx + kw.length);
  }
  for (const kw of keywordsSorted) {
    if (slug.includes(kw)) return kw.charAt(0).toUpperCase() + kw.slice(1);
  }
  const t = title.trim();
  if (t) return t;
  return String(post.slug || '').replace(/-/g, ' ') || 'Read more';
}

function countBlogRelativeLinks(content) {
  const re = /blog\.html\?slug=[^)\s\]"'>]+/gi;
  return (String(content || '').match(re) || []).length;
}

function slugLinkedInMarkdown(content, slug) {
  const want = String(slug || '');
  if (!want) return false;
  const re = /blog\.html\?slug=([^)\s\]"'>]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    let found = m[1];
    try {
      found = decodeURIComponent(found);
    } catch {
      /* keep raw */
    }
    if (found === want) return true;
  }
  return false;
}

function formatMarkdownInternalBlogLink(phrase, slug) {
  const lb = String(phrase || 'Post').replace(/\]/g, '\\]');
  const s = String(slug || '').trim();
  if (!s) return '';
  return `[${lb}](/blog.html?slug=${encodeURIComponent(s)})`;
}

function markdownSafeLink(label, url) {
  const safeUrl = sanitizeUrlForMarkdown(url);
  if (!safeUrl) return '';
  const lb = String(label || 'Read more').replace(/\]/g, '\\]');
  return `[${lb}](${safeUrl})`;
}

function pickInternalLinkSuggestions(currentId, currentSlug, content, titleHint) {
  const freq = extractKeywordFreq(`${content}\n${titleHint || ''}`);
  const keywordsSorted = sortedKeywordsByWeight(freq);
  const others = blogPostsCache.filter((p) => {
    if (String(p.id) === String(currentId) && currentId) return false;
    if (currentSlug && String(p.slug || '') === currentSlug) return false;
    return true;
  });
  const scored = others
    .map((p) => ({ post: p, sc: scorePostForInternalSuggest(p, freq) }))
    .sort((a, b) => b.sc - a.sc);
  const picks = [];
  const seen = new Set();
  for (const { post, sc } of scored) {
    if (picks.length >= 3) break;
    if (sc <= 0) continue;
    const slug = String(post.slug || '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    picks.push({ post, phrase: findMatchedPhrase(post, keywordsSorted) });
  }
  if (picks.length < 3) {
    const byDate = [...others].filter((p) => !seen.has(String(p.slug || '')));
    byDate.sort((a, b) => new Date(b.updatedAt || b.publishedAt || 0) - new Date(a.updatedAt || a.publishedAt || 0));
    for (const p of byDate) {
      if (picks.length >= 3) break;
      const slug = String(p.slug || '');
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      picks.push({ post: p, phrase: p.title || slug.replace(/-/g, ' ') || 'Read more' });
    }
  }
  return picks.slice(0, 3);
}

function updateContentChecklist() {
  const listEl = document.getElementById('contentChecklistList');
  const ctaWarn = document.getElementById('contentChecklistCtaWarn');
  const coverSeo = document.getElementById('coverImageSeoHint');
  const inlineImg = document.getElementById('inlineImageSeoHint');
  if (!listEl) return;

  const content = document.getElementById('postContent')?.value ?? '';
  const excerpt = document.getElementById('postExcerpt')?.value?.trim() ?? '';
  const metaTitle = document.getElementById('postMetaTitle')?.value?.trim() ?? '';
  const metaDesc = document.getElementById('postMetaDescription')?.value?.trim() ?? '';
  const coverRaw = document.getElementById('postCoverImageUrl')?.value?.trim() ?? '';
  const coverOk = Boolean(sanitizeAdminCoverUrl(coverRaw));

  const words = countMarkdownWords(content);
  const h23 = countH2H3Headings(content);
  const linkUrls = extractMarkdownLinkTargets(content);
  const internalOk = hasInternalCutupLink(linkUrls);
  const externalOk = hasExternalHttpLink(linkUrls);
  const ctaOk = hasCtaInMarkdown(content);

  const rows = [
    {
      ok: words >= CHECKLIST_MIN_WORDS,
      label: 'At least 800 words',
      detail: `${words} words (target ${CHECKLIST_MIN_WORDS}+)`
    },
    {
      ok: h23 >= CHECKLIST_MIN_H23,
      label: 'At least 3 headings (H2/H3)',
      detail: `${h23} H2/H3 headings (target ${CHECKLIST_MIN_H23}+)`
    },
    {
      ok: internalOk || /blog\.html\?slug=/i.test(content),
      label: 'At least 1 internal link (cutup.shop)',
      detail: internalOk || /blog\.html\?slug=/i.test(content)
        ? 'Found (site or /blog.html?slug=…)'
        : 'Add [label](https://cutup.shop/…) or [/blog.html?slug=…]'
    },
    {
      ok: externalOk,
      label: 'At least 1 external link',
      detail: externalOk ? 'Found (http/https, non-cutup)' : 'Add [label](https://example.com)'
    },
    {
      ok: ctaOk,
      label: 'Contains CTA (tool link or CTA copy)',
      detail: ctaOk ? 'CTA or cutup.shop/#tool detected' : 'Link to #tool or “Try it now” + cutup.shop'
    },
    {
      ok: excerpt.length > 0,
      label: 'Excerpt is filled',
      detail: excerpt.length ? `${excerpt.length} characters` : 'Empty'
    },
    {
      ok: metaTitle.length > 0,
      label: 'Meta title exists',
      detail: metaTitle.length ? `${metaTitle.length} characters` : 'Empty'
    },
    {
      ok: metaDesc.length > 0,
      label: 'Meta description exists',
      detail: metaDesc.length ? `${metaDesc.length} characters` : 'Empty'
    }
  ];

  listEl.innerHTML = rows.map((r) => `
    <li class="content-checklist-item ${r.ok ? 'is-ok' : 'is-warn'}">
      <span class="content-checklist-icon" aria-hidden="true">${r.ok ? '✓' : '!'}</span>
      <div>
        <span>${escapeHtml(r.label)}</span>
        <span class="content-checklist-detail">${escapeHtml(r.detail)}</span>
      </div>
    </li>
  `).join('');

  if (ctaWarn) {
    ctaWarn.hidden = ctaOk;
  }
  if (coverSeo) {
    coverSeo.hidden = coverOk;
  }
  if (inlineImg) {
    inlineImg.hidden = MD_IMAGE_RE.test(content);
  }
}

function runSuggestInternalLinks() {
  const ta = document.getElementById('postContent');
  const wrap = document.getElementById('internalLinkSuggestions');
  if (!ta || !wrap) return;
  const currentId = document.getElementById('postId')?.value?.trim() || '';
  const currentSlug = document.getElementById('postSlug')?.value?.trim() || '';
  const titleHint = document.getElementById('postTitle')?.value || '';
  const picks = pickInternalLinkSuggestions(currentId, currentSlug, ta.value, titleHint);
  wrap.innerHTML = '';
  wrap.hidden = false;
  if (!picks.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No other posts to suggest yet.';
    wrap.append(p);
    return;
  }
  const syncButtonState = (btn, slug) => {
    const body = ta.value;
    const atCap = countBlogRelativeLinks(body) >= INTERNAL_SUGGEST_MAX_LINKS;
    const dup = slugLinkedInMarkdown(body, slug);
    btn.disabled = atCap || dup;
    if (atCap) btn.title = `Maximum ${INTERNAL_SUGGEST_MAX_LINKS} internal blog links from suggestions.`;
    else if (dup) btn.title = 'This post is already linked.';
    else btn.removeAttribute('title');
  };

  picks.forEach(({ post, phrase }) => {
    const row = document.createElement('div');
    row.className = 'internal-suggest-row';
    const slug = String(post.slug || '');
    row.setAttribute('data-suggest-slug', slug);
    const span = document.createElement('span');
    span.textContent = post.title || post.slug || 'Post';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost';
    btn.textContent = 'Insert link';
    syncButtonState(btn, slug);
    btn.addEventListener('click', () => {
      if (countBlogRelativeLinks(ta.value) >= INTERNAL_SUGGEST_MAX_LINKS) {
        showBanner(`You can add at most ${INTERNAL_SUGGEST_MAX_LINKS} internal links this way.`);
        return;
      }
      if (slugLinkedInMarkdown(ta.value, slug)) {
        showBanner('That post is already linked in the content.');
        return;
      }
      const md = formatMarkdownInternalBlogLink(phrase, slug);
      if (!md) return;
      insertRawAtCursor(ta, `\n${md}\n`);
      updatePreviewIfOpen();
      updateContentChecklist();
      wrap.querySelectorAll('.internal-suggest-row').forEach((r) => {
        const b = r.querySelector('button');
        const s = r.getAttribute('data-suggest-slug') || '';
        if (b) syncButtonState(b, s);
      });
    });
    row.append(span, btn);
    wrap.append(row);
  });
}

function handleMarkdownTool(action) {
  const ta = document.getElementById('postContent');
  if (!ta) return;
  if (action === 'h1') return insertAtCursor(ta, '# ', '', 'Heading');
  if (action === 'h2') return insertAtCursor(ta, '## ', '', 'Subheading');
  if (action === 'bold') return insertAtCursor(ta, '**', '**', 'bold text');
  if (action === 'italic') return insertAtCursor(ta, '*', '*', 'italic text');
  if (action === 'bullet') return insertAtCursor(ta, '- ', '', 'List item');
  if (action === 'numbered') return insertAtCursor(ta, '1. ', '', 'List item');
  if (action === 'link') return insertAtCursor(ta, '[', '](https://example.com)', 'link text');
  if (action === 'cta') return insertAtCursor(ta, '\n', '\n', MD_CTA_TEXT);
}

function showBanner(message) {
  const el = document.getElementById('adminBanner');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 5000);
}

async function apiGet(action, params = {}) {
  const q = new URLSearchParams({ action, session: currentSession, ...params });
  const response = await fetch(`${API_BASE_URL}/api/admin?${q.toString()}`, {
    headers: { 'X-Session-Id': currentSession }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiPost(action, payload = {}) {
  const response = await fetch(`${API_BASE_URL}/api/admin?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': currentSession },
    body: JSON.stringify({ ...payload, session: currentSession })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error || `Request failed (${response.status})`;
    console.error('[admin] apiPost failed', { action, status: response.status, payload, response: data });
    throw new Error(message);
  }
  return data;
}

async function loadMe() {
  const q = new URLSearchParams({ action: 'me', session: currentSession });
  const response = await fetch(`${API_BASE_URL}/api/auth?${q.toString()}`, { headers: { 'X-Session-Id': currentSession } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.user) throw new Error('Please login first.');
  currentUser = data.user;
  const identity = document.getElementById('adminIdentity');
  if (identity) identity.textContent = `${currentUser.name || currentUser.email} (${currentUser.email})`;
}

function renderOverview(data) {
  const cards = [
    ['Total users', data.totalUsers, 'All registered accounts'],
    ['Active this month', data.activeUsersThisMonth, 'Users with current month activity'],
    ['Processed minutes', data.totalProcessedMinutes, 'Across all plans'],
    ['Videos estimate', data.totalVideosEstimate, 'Approx from total minutes'],
    ['Saved outputs', data.totalSavedOutputs, 'Transcripts / summaries / SRT'],
    ['Audio downloads', data.totalAudioDownloads, 'All-time total'],
    ['Video downloads', data.totalVideoDownloads, 'All-time total'],
    ['Revenue', data.revenue == null ? '—' : data.revenue, data.revenueNote || '']
  ];
  const el = document.getElementById('overviewCards');
  if (!el) return;
  el.innerHTML = cards.map(([k, v, hint]) => `
    <article class="card">
      <h3>${escapeHtml(k)}</h3>
      <p>${escapeHtml(v)}</p>
      <div class="metric-subtle">${escapeHtml(hint || '')}</div>
    </article>
  `).join('');
}

function renderUsersTable(rows) {
  const el = document.getElementById('usersTable');
  if (!el) return;
  el.innerHTML = `
    <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Status</th><th>Created</th><th>Last activity</th><th>Usage this month</th><th>Saved outputs</th></tr></thead>
    <tbody>
      ${(rows.length ? rows : []).map((u) => `<tr>
        <td>${escapeHtml(u.name || '—')}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${statusBadge(u.plan || 'free')}</td>
        <td>${statusBadge(u.status || 'active', (u.status || '').toLowerCase() === 'active' ? 'ok' : 'warn')}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>${fmtDate(u.lastActivityAt)}</td>
        <td>${escapeHtml(u.usageMinutesThisMonth)}</td>
        <td>${escapeHtml(u.savedOutputsCount)}</td>
      </tr>`).join('') || emptyRow(8, 'No users found for this filter.')}
    </tbody>`;
}

function renderUsageTable(rows) {
  const el = document.getElementById('usageTable');
  if (!el) return;
  el.innerHTML = `
    <thead><tr><th>Type</th><th>User</th><th>Platform</th><th>Title</th><th>Date</th><th>Minutes</th><th>Source URL</th></tr></thead>
    <tbody>
      ${(rows.length ? rows : []).map((r) => {
        const platform = r.metadata?.platform || r.metadata?.source || 'unknown';
        const title = r.metadata?.title || r.metadata?.videoTitle || r.metadata?.filename || '—';
        const src = r.metadata?.sourceUrl || r.metadata?.url || '';
        return `<tr>
          <td>${statusBadge(r.type || 'unknown')}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>${escapeHtml(platform)}</td>
          <td>${escapeHtml(title)}</td>
          <td>${fmtDate(r.createdAt)}</td>
          <td>${escapeHtml(r.minutes || 0)}</td>
          <td>${src ? `<a class="truncate-link" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src)}</a>` : '<span class="muted">—</span>'}</td>
        </tr>`;
      }).join('') || emptyRow(7, 'No usage activity matches the selected filters.')}
    </tbody>`;
}

function renderOutputsTable(rows) {
  const el = document.getElementById('outputsTable');
  if (!el) return;
  el.innerHTML = `
    <thead><tr><th>User</th><th>Title</th><th>Type</th><th>Platform</th><th>Language</th><th>Favorite</th><th>Created</th><th>Preview</th></tr></thead>
    <tbody>
      ${(rows.length ? rows : []).map((o) => `<tr>
        <td>${escapeHtml(o.email)}</td>
        <td>${escapeHtml(o.title || '—')}</td>
        <td>${statusBadge(o.type || 'unknown')}</td>
        <td>${escapeHtml(o.platform || '—')}</td>
        <td>${escapeHtml(o.language || '—')}</td>
        <td>${o.isFavorite ? statusBadge('Pinned', 'ok') : '<span class="muted">—</span>'}</td>
        <td>${fmtDate(o.createdAt)}</td>
        <td><details><summary>View</summary><pre>${escapeHtml(o.content || '')}</pre></details></td>
      </tr>`).join('') || emptyRow(8, 'No saved outputs available yet.')}
    </tbody>`;
}

function renderPaymentsPanel(data, abData) {
  const stripe = data.stripeConfig || {};
  const dist = data.planDistribution || [];
  const ab = abData && typeof abData === 'object' ? abData : {};
  const funnel = Array.isArray(ab.funnelByVariant) ? ab.funnelByVariant : [];
  const byPlan = Array.isArray(ab.byPlan) ? ab.byPlan : [];
  const container = document.getElementById('paymentsPanel');
  if (!container) return;
  container.innerHTML = `
    <div class="cards-grid">
      <article class="card"><h3>Paid users</h3><p>${escapeHtml(data.paidUsers)}</p><div class="metric-subtle">Starter / Pro / Business (Stripe) · custom Business accounts</div></article>
      <article class="card"><h3>Revenue</h3><p>—</p><div class="metric-subtle">${escapeHtml(data.revenueNote)}</div></article>
    </div>
    <h3>Pricing A/B test</h3>
    <p class="metric-subtle">Full funnel: pricing_viewed → upgrade_clicked → payment_started → payment_success. Conversion = payments ÷ views (same variant).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Variant</th><th>Views</th><th>Clicks</th><th>Started</th><th>Payments</th><th>Failed verify</th><th>Conv. %</th></tr></thead>
      <tbody>
        ${funnel.length
          ? funnel.map((r) => `<tr>
            <td>${statusBadge(String(r.variant || '—'))}</td>
            <td>${escapeHtml(r.views)}</td>
            <td>${escapeHtml(r.clicks)}</td>
            <td>${escapeHtml(r.started)}</td>
            <td>${escapeHtml(r.payments)}</td>
            <td>${escapeHtml(r.failed)}</td>
            <td>${r.conversionPct != null ? escapeHtml(r.conversionPct) + '%' : '<span class="muted">—</span>'}</td>
          </tr>`).join('')
          : emptyRow(7, 'No pricing experiment events yet.')}
      </tbody>
    </table></div>
    <h4>By plan (clicks / started / payments)</h4>
    <div class="table-wrap"><table>
      <thead><tr><th>Variant</th><th>Plan</th><th>Clicks</th><th>Started</th><th>Payments</th></tr></thead>
      <tbody>
        ${byPlan.length
          ? byPlan.map((r) => `<tr>
            <td>${statusBadge(String(r.variant || '—'))}</td>
            <td>${escapeHtml(r.plan)}</td>
            <td>${escapeHtml(r.clicks)}</td>
            <td>${escapeHtml(r.started)}</td>
            <td>${escapeHtml(r.payments)}</td>
          </tr>`).join('')
          : emptyRow(5, 'No per-plan breakdown yet.')}
      </tbody>
    </table></div>
    <h3>Plan distribution</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Plan</th><th>Users</th></tr></thead>
      <tbody>${dist.length ? dist.map((d) => `<tr><td>${statusBadge(d.plan)}</td><td>${escapeHtml(d.count)}</td></tr>`).join('') : emptyRow(2, 'No plan distribution data yet.')}</tbody>
    </table></div>
    <h3>Stripe readiness</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Variable</th><th>Status</th></tr></thead>
      <tbody>
        ${Object.entries(stripe).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v ? statusBadge('Configured', 'ok') : statusBadge('Missing', 'warn')}</td></tr>`).join('')}
      </tbody>
    </table></div>
  `;
}

function renderHealthPanel(data) {
  const env = data.envReadiness || {};
  const db = data.database || {};
  const tools = data.tools || {};
  const events = data.recentEvents || [];
  const container = document.getElementById('healthPanel');
  if (!container) return;
  container.innerHTML = `
    <div class="cards-grid">
      <article class="card"><h3>API health</h3><p>${statusBadge(data.api || 'unknown', data.api === 'ok' ? 'ok' : 'warn')}</p><div class="metric-subtle">Admin endpoint status</div></article>
      <article class="card"><h3>Database</h3><p>${db.connected ? statusBadge('OK', 'ok') : statusBadge('Error', 'err')}</p><div class="metric-subtle">Connection + table checks</div></article>
      <article class="card"><h3>yt-dlp</h3><p>${tools.ytdlp ? statusBadge('OK', 'ok') : statusBadge('Missing', 'warn')}</p><div class="metric-subtle">Download dependency</div></article>
      <article class="card"><h3>ffmpeg</h3><p>${tools.ffmpeg ? statusBadge('OK', 'ok') : statusBadge('Missing', 'warn')}</p><div class="metric-subtle">Media conversion dependency</div></article>
    </div>
    <h3>Environment readiness</h3>
    <div class="table-wrap"><table><thead><tr><th>Key</th><th>Status</th></tr></thead><tbody>
      ${Object.entries(env).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v ? statusBadge('Configured', 'ok') : statusBadge('Missing', 'warn')}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>Required tables</h3>
    <div class="table-wrap"><table><thead><tr><th>Table</th><th>Status</th></tr></thead><tbody>
      ${Object.entries(db.tables || {}).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v ? statusBadge('OK', 'ok') : statusBadge('Missing', 'err')}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>Recent admin-readable events</h3>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>User</th><th>Type</th><th>Minutes</th></tr></thead><tbody>
      ${(events.length ? events : []).map((e) => `<tr><td>${fmtDate(e.createdAt)}</td><td>${escapeHtml(e.email || '—')}</td><td>${statusBadge(e.type || '—')}</td><td>${escapeHtml(e.minutes || 0)}</td></tr>`).join('') || emptyRow(4, 'No recent events available.')}
    </tbody></table></div>
  `;
}

function renderBlogTable(posts) {
  const el = document.getElementById('blogTable');
  if (!el) return;
  el.innerHTML = `
    <thead><tr><th class="blog-thumb-cell">Cover</th><th>Title</th><th>Status</th><th>Category</th><th>Updated</th><th>Actions</th></tr></thead>
    <tbody>
      ${(posts.length ? posts : []).map((p) => {
        const cover = sanitizeAdminCoverUrl(p.coverImageUrl || '');
        const phLabel = (p.category || '').trim().slice(0, 4) || '—';
        const thumb = cover
          ? `<img class="blog-list-thumb" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`
          : `<span class="blog-list-thumb-placeholder" title="No cover">${escapeHtml(phLabel)}</span>`;
        const actions = [
          `<button class="btn ghost blog-action-btn" data-edit-post="${p.id}">Edit</button>`,
          p.status === 'published'
            ? `<a class="btn ghost blog-action-btn" href="blog.html?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener noreferrer">View public</a>`
            : '',
          p.status === 'published'
            ? `<button class="btn ghost blog-action-btn" data-unpublish-post="${p.id}">Unpublish</button>`
            : `<button class="btn ghost blog-action-btn" data-publish-post="${p.id}">Publish</button>`
        ].filter(Boolean).join('');
        return `<tr>
        <td class="blog-thumb-cell">${thumb}</td>
        <td><div class="blog-title-cell"><strong>${escapeHtml(p.title)}</strong><span class="muted">${escapeHtml(p.slug)}</span></div></td>
        <td>${statusBadge(p.status, p.status === 'published' ? 'ok' : 'neutral')}</td><td>${escapeHtml(p.category || '—')}</td><td>${fmtDate(p.updatedAt)}</td>
        <td><div class="blog-actions-wrap">${actions}</div></td>
      </tr>`;
      }).join('') || emptyRow(6, 'No blog posts yet. Create your first draft.')}
    </tbody>`;
  el.querySelectorAll('.blog-list-thumb').forEach((img) => {
    img.addEventListener('error', () => {
      const td = img.closest('td');
      if (td) td.innerHTML = '<span class="blog-list-thumb-placeholder" title="Bad image">!</span>';
    });
  });
  el.querySelectorAll('[data-edit-post]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const post = blogPostsCache.find((x) => String(x.id) === btn.getAttribute('data-edit-post'));
      if (post) fillBlogForm(post);
    });
  });
  el.querySelectorAll('[data-publish-post]').forEach((btn) => {
    btn.addEventListener('click', () => quickTogglePublish(btn.getAttribute('data-publish-post'), true));
  });
  el.querySelectorAll('[data-unpublish-post]').forEach((btn) => {
    btn.addEventListener('click', () => quickTogglePublish(btn.getAttribute('data-unpublish-post'), false));
  });
}

function fillBlogForm(post) {
  slugManuallyEdited = Boolean(post?.slug);
  document.getElementById('postId').value = post.id || '';
  document.getElementById('postSlug').value = post.slug || '';
  document.getElementById('postTitle').value = post.title || '';
  document.getElementById('postExcerpt').value = post.excerpt || '';
  document.getElementById('postCoverImageUrl').value = post.coverImageUrl || '';
  document.getElementById('postContent').value = post.content || '';
  document.getElementById('postStatus').value = post.status || 'draft';
  document.getElementById('postCategory').value = post.category || '';
  document.getElementById('postTags').value = (post.tags || []).join(', ');
  document.getElementById('postMetaTitle').value = post.metaTitle || '';
  document.getElementById('postMetaDescription').value = post.metaDescription || '';
  document.getElementById('postCanonicalUrl').value = post.canonicalUrl || '';
  document.getElementById('postOgTitle').value = post.ogTitle || '';
  document.getElementById('postOgDescription').value = post.ogDescription || '';
  updateCoverPreview();
  updateSeoCounters();
  updatePreviewIfOpen();
  const sug = document.getElementById('internalLinkSuggestions');
  if (sug) {
    sug.hidden = true;
    sug.innerHTML = '';
  }
  updateContentChecklist();
}

function readBlogForm() {
  const postIdRaw = document.getElementById('postId')?.value?.trim();
  return {
    id: postIdRaw || null,
    slug: document.getElementById('postSlug').value.trim(),
    title: document.getElementById('postTitle').value.trim(),
    excerpt: document.getElementById('postExcerpt').value.trim(),
    coverImageUrl: document.getElementById('postCoverImageUrl').value.trim(),
    content: document.getElementById('postContent').value,
    status: document.getElementById('postStatus').value,
    category: document.getElementById('postCategory').value.trim(),
    tags: document.getElementById('postTags').value.split(',').map((t) => t.trim()).filter(Boolean),
    metaTitle: document.getElementById('postMetaTitle').value.trim(),
    metaDescription: document.getElementById('postMetaDescription').value.trim(),
    canonicalUrl: document.getElementById('postCanonicalUrl').value.trim(),
    ogTitle: document.getElementById('postOgTitle').value.trim(),
    ogDescription: document.getElementById('postOgDescription').value.trim()
  };
}

async function quickTogglePublish(id, publish) {
  if (!id) return;
  try {
    await apiPost('publishBlogPost', { id, publish });
    showBanner(publish ? 'Post published successfully.' : 'Post moved to draft.');
    await loadBlogPosts();
    const currentId = document.getElementById('postId')?.value;
    if (currentId && String(currentId) === String(id)) {
      const updated = blogPostsCache.find((x) => String(x.id) === String(id));
      if (updated) fillBlogForm(updated);
    }
  } catch (err) {
    console.error('[admin] quick publish toggle error', err);
    showBanner(err.message || 'Could not update post status.');
  }
}

async function loadOverview() { renderOverview(await apiGet('overview')); }
async function loadUsers() {
  const search = document.getElementById('usersSearch')?.value || '';
  const plan = document.getElementById('usersPlanFilter')?.value || 'all';
  const data = await apiGet('users', { search, plan });
  renderUsersTable(data.users || []);
}
async function loadUsage() {
  const data = await apiGet('usage', {
    type: document.getElementById('usageTypeFilter')?.value || 'all',
    platform: document.getElementById('usagePlatformFilter')?.value || 'all',
    startDate: document.getElementById('usageStartDate')?.value || '',
    endDate: document.getElementById('usageEndDate')?.value || ''
  });
  renderUsageTable(data.activities || []);
}
async function loadOutputs() { renderOutputsTable((await apiGet('savedOutputs')).outputs || []); }
async function loadPayments() {
  const [pay, ab] = await Promise.all([apiGet('payments'), apiGet('pricingAb')]);
  renderPaymentsPanel(pay, ab);
}
async function loadHealth() { renderHealthPanel(await apiGet('health')); }
async function loadBlogPosts() {
  const data = await apiGet('blogPosts');
  blogPostsCache = data.posts || [];
  renderBlogTable(blogPostsCache);
}

async function refreshSection(section) {
  if (section === 'overview') return loadOverview();
  if (section === 'users') return loadUsers();
  if (section === 'usage') return loadUsage();
  if (section === 'outputs') return loadOutputs();
  if (section === 'payments') return loadPayments();
  if (section === 'health') return loadHealth();
  if (section === 'blog') return loadBlogPosts();
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const section = btn.getAttribute('data-section');
      document.querySelectorAll('.nav-btn').forEach((n) => n.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`section-${section}`)?.classList.add('active');
      try { await refreshSection(section); } catch (e) { showBanner(e.message || 'Could not load data.'); }
    });
  });
}

function setupActions() {
  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth?action=logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': currentSession },
        body: JSON.stringify({ session: currentSession })
      });
    } catch {}
    localStorage.removeItem('cutup_session');
    window.location.href = '/';
  });
  document.getElementById('usersReloadBtn')?.addEventListener('click', () => loadUsers().catch((e) => showBanner(e.message)));
  document.getElementById('usageReloadBtn')?.addEventListener('click', () => loadUsage().catch((e) => showBanner(e.message)));
  const titleEl = document.getElementById('postTitle');
  const slugEl = document.getElementById('postSlug');
  const contentEl = document.getElementById('postContent');
  const writeTab = document.getElementById('editorWriteTab');
  const previewTab = document.getElementById('editorPreviewTab');

  document.getElementById('reloadPostsBtn')?.addEventListener('click', () => loadBlogPosts().catch((e) => showBanner(e.message)));
  document.getElementById('newPostBtn')?.addEventListener('click', () => {
    slugManuallyEdited = false;
    fillBlogForm({ status: 'draft', tags: [] });
    setEditorMode('write');
    const sug = document.getElementById('internalLinkSuggestions');
    if (sug) {
      sug.hidden = true;
      sug.innerHTML = '';
    }
  });
  document.getElementById('postMetaTitle')?.addEventListener('input', () => {
    updateSeoCounters();
    updateContentChecklist();
  });
  document.getElementById('postMetaDescription')?.addEventListener('input', () => {
    updateSeoCounters();
    updateContentChecklist();
  });
  document.getElementById('postExcerpt')?.addEventListener('input', () => {
    updateSeoCounters();
    updateContentChecklist();
  });

  titleEl?.addEventListener('input', () => {
    if (!slugEl || slugManuallyEdited) return;
    const next = slugifyTitle(titleEl.value);
    if (next) slugEl.value = next;
  });
  slugEl?.addEventListener('input', () => {
    slugManuallyEdited = true;
  });

  contentEl?.addEventListener('input', () => {
    updatePreviewIfOpen();
    updateContentChecklist();
  });
  document.getElementById('postCoverImageUrl')?.addEventListener('input', () => {
    updateCoverPreview();
    updateContentChecklist();
  });
  writeTab?.addEventListener('click', () => setEditorMode('write'));
  previewTab?.addEventListener('click', () => setEditorMode('preview'));
  document.querySelectorAll('.md-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleMarkdownTool(btn.getAttribute('data-md')));
  });
  document.getElementById('suggestInternalLinksBtn')?.addEventListener('click', () => runSuggestInternalLinks());

  const validateBlogPayload = (payload, forPublish = false) => {
    if (!payload.title) {
      showBanner('Title is required before saving.');
      return false;
    }
    if (!payload.slug) {
      showBanner('Slug is required before saving.');
      return false;
    }
    if (forPublish && !String(payload.content || '').trim()) {
      showBanner('Content is recommended before publishing.');
    }
    return true;
  };
  document.getElementById('blogForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = readBlogForm();
      if (!validateBlogPayload(payload, false)) return;
      console.log('[admin] saveBlogPost payload', {
        id: payload.id,
        title: payload.title,
        slug: payload.slug,
        contentLength: String(payload.content || '').length,
        status: payload.status,
        category: payload.category,
        tagsCount: Array.isArray(payload.tags) ? payload.tags.length : 0
      });
      const saved = await apiPost('saveBlogPost', payload);
      if (saved?.id) {
        document.getElementById('postId').value = String(saved.id);
      }
      showBanner('Post saved.');
      await loadBlogPosts();
      if (saved?.id) {
        const post = blogPostsCache.find((x) => String(x.id) === String(saved.id));
        if (post) fillBlogForm(post);
      }
    } catch (err) {
      console.error('[admin] saveBlogPost error', err);
      showBanner(err.message || 'Could not save post.');
    }
  });
  document.getElementById('publishToggleBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('postId')?.value;
    const status = document.getElementById('postStatus')?.value;
    try {
      if (!id) {
        const payload = readBlogForm();
        payload.status = 'published';
        if (!validateBlogPayload(payload, true)) return;
        const saved = await apiPost('saveBlogPost', payload);
        if (saved?.id) document.getElementById('postId').value = String(saved.id);
        document.getElementById('postStatus').value = 'published';
        showBanner('Post published successfully.');
        await loadBlogPosts();
        if (saved?.id) {
          const post = blogPostsCache.find((x) => String(x.id) === String(saved.id));
          if (post) fillBlogForm(post);
        }
        return;
      }
      const existingPayload = readBlogForm();
      if (!validateBlogPayload(existingPayload, status !== 'published')) return;
      await apiPost('publishBlogPost', { id, publish: status !== 'published' });
      showBanner(status !== 'published' ? 'Post published successfully.' : 'Post moved to draft.');
      await loadBlogPosts();
    } catch (err) {
      console.error('[admin] publishBlogPost error', err);
      showBanner(err.message || 'Could not publish post.');
    }
  });
  updateSeoCounters();
  setEditorMode('write');
  updateContentChecklist();
}

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  currentSession = params.get('session') || localStorage.getItem('cutup_session');
  if (!currentSession) {
    window.location.href = '/';
    return;
  }
  localStorage.setItem('cutup_session', currentSession);
  setupNavigation();
  setupActions();
  try {
    await loadMe();
    await Promise.all([loadOverview(), loadUsers(), loadUsage(), loadOutputs(), loadPayments(), loadHealth(), loadBlogPosts()]);
  } catch (e) {
    showBanner(e.message || 'Admin access is unavailable.');
  }
});
