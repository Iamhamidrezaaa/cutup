/**
 * Programmatic SEO tool landing pages — config-driven.
 * Add new entries to TOOL_PAGES to scale (100+ pages).
 */
const API_BASE_URL = 'https://cutup.shop';
const BLOG_ENDPOINT = `${API_BASE_URL}/api/admin?action=blogPosts&public=1`;
const MAIN_TOOL_HREF = '/#tool';

function toolsContentUrl(type) {
  try {
    const o = window.location.origin;
    if (o && o !== 'null' && !o.startsWith('file:')) {
      return `${o}/api/tools-content?type=${encodeURIComponent(type)}`;
    }
  } catch {
    /* ignore */
  }
  return `${API_BASE_URL}/api/tools-content?type=${encodeURIComponent(type)}`;
}

const TOOL_PAGES = {
  'youtube-to-text': {
    title: 'YouTube to Text Converter – Free AI Tool | Cutup',
    h1: 'YouTube to Text Converter',
    description:
      'Convert YouTube videos to text instantly with AI. Generate subtitles, transcripts, and captions in seconds.',
    intro:
      'Cutup turns YouTube links into clean transcripts and timed subtitles you can edit, download, and reuse. Built for creators, students, and teams who need fast, readable text without manual typing.',
    features: [
      'Paste any public YouTube URL — no extension required',
      'AI-powered speech-to-text tuned for clear, readable transcripts',
      'Timed subtitles you can tweak before download',
      'Works alongside our file upload flow for your own media',
    ],
    useCases: [
      {
        title: 'Creators & editors',
        body: 'Repurpose long videos into blog posts, quotes, and chapter outlines without rewatching.',
      },
      {
        title: 'Students & researchers',
        body: 'Capture lectures and interviews as searchable text for notes and citations.',
      },
      {
        title: 'Teams & accessibility',
        body: 'Generate a first draft of captions to improve reach and meet accessibility goals faster.',
      },
    ],
    faqs: [
      {
        q: 'How do I convert YouTube to text?',
        a: 'Open Cutup, paste your YouTube link in the tool, and run a preview. You get a transcript and subtitle preview you can refine and export based on your plan.',
      },
      {
        q: 'Is there a free preview?',
        a: 'Yes. You can try the workflow without a full commitment; heavier usage and exports are tied to plans shown on the homepage.',
      },
      {
        q: 'Do you support SRT or other formats?',
        a: 'Cutup focuses on subtitles and transcripts; check the main app for the latest export options for your account.',
      },
      {
        q: 'Can I use this for Shorts or long videos?',
        a: 'Public URLs supported by our pipeline work best. Very long files may be subject to fair-use limits on your plan.',
      },
    ],
    keywords: ['youtube to text', 'youtube transcript', 'youtube subtitles', 'video to text', 'cutup'],
    relatedTools: ['instagram-subtitles', 'tiktok-caption-generator'],
  },
  'instagram-subtitles': {
    title: 'Instagram Subtitle Generator – Fast & Free | Cutup',
    h1: 'Instagram Subtitle Generator',
    description:
      'Convert Instagram Reels to captions instantly with AI. Generate subtitles, transcripts, and polished on-screen text in seconds.',
    intro:
      'Short-form video on Instagram needs crisp captions. Cutup helps you pull speech from supported Instagram URLs into text and timed lines you can polish and reuse across posts and stories.',
    features: [
      'Optimized for quick captions on short vertical video',
      'Editable subtitle lines before you publish or export',
      'Same Cutup account as YouTube and TikTok — one workflow',
      'Designed for creators who batch content across platforms',
    ],
    useCases: [
      {
        title: 'Reels growth',
        body: 'Hook viewers who watch on mute with accurate on-brand captions.',
      },
      {
        title: 'Agencies',
        body: 'Draft captions for client approvals faster than manual typing.',
      },
      {
        title: 'Multilingual drafts',
        body: 'Start from a solid ASR baseline before professional translation.',
      },
    ],
    faqs: [
      {
        q: 'Does Cutup work with Instagram links?',
        a: 'When our download pipeline supports the URL, you can generate subtitles the same way as other platforms. Paste the link in the main tool to see if it is accepted.',
      },
      {
        q: 'Can I edit captions before posting?',
        a: 'Yes. Review and adjust lines in the editor so tone and timing match your brand.',
      },
      {
        q: 'Is this the same as Instagram auto-captions?',
        a: 'Cutup gives you a separate workflow you control — export and iterate outside the native editor when needed.',
      },
    ],
    keywords: ['instagram subtitles', 'reels captions', 'instagram captions generator', 'video captions', 'cutup'],
    relatedTools: ['youtube-to-text', 'tiktok-caption-generator'],
  },
  'tiktok-caption-generator': {
    title: 'TikTok Caption Generator – Free AI Tool | Cutup',
    h1: 'TikTok Caption Generator',
    description:
      'Convert TikTok videos to captions instantly with AI. Generate subtitles, transcripts, and scroll-stopping lines in seconds.',
    intro:
      'TikTok moves fast — your caption workflow should too. Cutup extracts speech from compatible TikTok URLs so you can fix hooks, hashtags, and timing without starting from a blank timeline.',
    features: [
      'Built for short, high-tempo clips common on TikTok',
      'Transcript + timed captions in one pass',
      'Easy hand-off to editors who work in other tools',
      'Consistent with Cutup’s YouTube and Instagram flows',
    ],
    useCases: [
      {
        title: 'Trend-jacking',
        body: 'Turn viral audio into text for scripts, stitches, and duet ideas.',
      },
      {
        title: 'Brand safety',
        body: 'Review exactly what was said before you boost or repurpose a clip.',
      },
      {
        title: 'Cross-posting',
        body: 'Reuse TikTok speech as quotes for X, LinkedIn, or newsletters.',
      },
    ],
    faqs: [
      {
        q: 'How do I get captions for a TikTok video?',
        a: 'Paste the TikTok URL into Cutup’s main tool. If the URL is supported, you will see a preview transcript and subtitles you can edit.',
      },
      {
        q: 'Are captions accurate for slang or music?',
        a: 'ASR quality depends on audio clarity. Clean speech works best; heavy music or noise may need manual cleanup.',
      },
      {
        q: 'Can I use Cutup for other platforms too?',
        a: 'Yes. Explore our other landing pages for YouTube and Instagram-style workflows.',
      },
    ],
    keywords: ['tiktok captions', 'tiktok subtitle generator', 'tiktok transcript', 'short video captions', 'cutup'],
    relatedTools: ['youtube-to-text', 'instagram-subtitles'],
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Natural anchor text for internal guide links (not “click here”). */
function guideLinkLabel(post, toolKey) {
  const title = String(post.title || '').trim();
  const slug = String(post.slug || '').trim().toLowerCase();
  const toolFallback = {
    'youtube-to-text': 'how to generate subtitles for YouTube videos',
    'instagram-subtitles': 'how to generate subtitles for Instagram Reels',
    'tiktok-caption-generator': 'how to add TikTok captions and subtitles',
  };

  if (title) {
    const t = title.toLowerCase();
    if (t.startsWith('how ') || t.startsWith('what ') || t.startsWith('why ') || t.startsWith('when ')) {
      return title.charAt(0).toLowerCase() + title.slice(1);
    }
    return title;
  }
  if (toolKey && toolFallback[toolKey]) {
    return toolFallback[toolKey];
  }
  if (slug) {
    return `how to get subtitles and transcripts for ${slug.replace(/-/g, ' ')}`;
  }
  return 'Cutup subtitles and transcription guide';
}

function removeToolsPageJsonLd() {
  document.getElementById('tools-page-jsonld')?.remove();
}

function upsertToolsPageJsonLd(key, page) {
  removeToolsPageJsonLd();
  const script = document.createElement('script');
  script.id = 'tools-page-jsonld';
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url: toolPageUrl(key),
  });
  document.head.appendChild(script);
}

function sanitizeTypeParam(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(s)) return '';
  return s;
}

function setMetaByName(name, content) {
  if (content == null || content === '') return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setMetaByProperty(prop, content) {
  if (content == null || content === '') return;
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

function toolPageUrl(key) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?type=${encodeURIComponent(key)}`;
}

function applySeo(key, page) {
  document.title = page.title;
  setMetaByName('description', page.description);
  setMetaByProperty('og:title', page.title);
  setMetaByProperty('og:description', page.description);
  setMetaByProperty('og:url', toolPageUrl(key));
  setCanonical(toolPageUrl(key));
  if (Array.isArray(page.keywords) && page.keywords.length) {
    setMetaByName('keywords', page.keywords.map((k) => String(k).trim()).filter(Boolean).join(', '));
  }
}

function defaultRelatedKeys(currentKey) {
  const page = TOOL_PAGES[currentKey];
  if (page && Array.isArray(page.relatedTools) && page.relatedTools.length) {
    return page.relatedTools.filter((k) => k !== currentKey && TOOL_PAGES[k]);
  }
  return Object.keys(TOOL_PAGES).filter((k) => k !== currentKey);
}

function clearRoot(root) {
  root.textContent = '';
}

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => {
    if (v != null) node.setAttribute(k, v);
  });
  return node;
}

function renderToolPage(key, page) {
  const root = document.getElementById('toolsPageRoot');
  if (!root) return;
  clearRoot(root);
  applySeo(key, page);
  upsertToolsPageJsonLd(key, page);
  console.log('[seo] tools page rendered:', key);

  const hero = el('section', 'tools-hero');
  const h1 = document.createElement('h1');
  h1.textContent = page.h1;
  const lead = el('p', 'tools-hero-lead');
  lead.textContent = page.description;
  const ctaHero = el('a', 'tools-btn-primary', { href: MAIN_TOOL_HREF });
  ctaHero.textContent = 'Open the tool';
  hero.append(h1, lead, ctaHero);
  root.appendChild(hero);

  const introSec = el('section', 'tools-section tools-intro');
  const introH = document.createElement('h2');
  introH.textContent = 'Overview';
  introSec.appendChild(introH);
  String(page.intro || '')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((para) => {
      const p = document.createElement('p');
      p.textContent = para;
      introSec.appendChild(p);
    });
  root.appendChild(introSec);

  let anchorForExpanded = introSec;
  if (Array.isArray(page.features) && page.features.length) {
    const featSec = el('section', 'tools-section');
    const fh = document.createElement('h2');
    fh.textContent = 'What you get';
    featSec.appendChild(fh);
    const featBox = el('div', 'tools-features');
    const ul = document.createElement('ul');
    page.features.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    featBox.appendChild(ul);
    featSec.appendChild(featBox);
    root.appendChild(featSec);
    anchorForExpanded = featSec;
  }

  anchorForExpanded.after(buildExpandedLoadingMount());
  loadExpandedToolContent(key);

  if (Array.isArray(page.useCases) && page.useCases.length) {
    const ucSec = el('section', 'tools-section');
    const uch = document.createElement('h2');
    uch.textContent = 'Use cases';
    ucSec.appendChild(uch);
    const grid = el('div', 'tools-use-grid');
    page.useCases.forEach((uc) => {
      const card = el('article', 'tools-use-card');
      const h3 = document.createElement('h3');
      h3.textContent = uc.title || '';
      const p = document.createElement('p');
      p.textContent = uc.body || '';
      card.append(h3, p);
      grid.appendChild(card);
    });
    ucSec.appendChild(grid);
    root.appendChild(ucSec);
  }

  if (Array.isArray(page.faqs) && page.faqs.length) {
    const faqSec = el('section', 'tools-section tools-faq');
    const fqh = document.createElement('h2');
    fqh.textContent = 'FAQ';
    faqSec.appendChild(fqh);
    page.faqs.forEach((item) => {
      const det = el('details', 'tools-faq-item');
      const sum = document.createElement('summary');
      sum.textContent = item.q || '';
      const body = el('div', 'tools-faq-body');
      body.textContent = item.a || '';
      det.append(sum, body);
      faqSec.appendChild(det);
    });
    root.appendChild(faqSec);
  }

  const ctaBlock = el('section', 'tools-cta-block');
  const ctaH = document.createElement('h2');
  ctaH.textContent = 'Ready to try Cutup?';
  const ctaP = document.createElement('p');
  ctaP.textContent = 'Paste your link on the main page and preview subtitles in seconds.';
  const ctaBtn = el('a', 'tools-btn-primary', { href: MAIN_TOOL_HREF });
  ctaBtn.textContent = 'Go to generator';
  ctaBlock.append(ctaH, ctaP, ctaBtn);
  root.appendChild(ctaBlock);

  const guidesSec = el('section', 'tools-section tools-guides-section');
  const guidesH2 = document.createElement('h2');
  guidesH2.textContent = 'Related guides';
  const guidesUl = el('ul', 'tools-link-list tools-guide-links');
  guidesUl.id = 'toolsRelatedGuides';
  guidesSec.append(guidesH2, guidesUl);
  root.appendChild(guidesSec);

  const internal = el('div', 'tools-internal');
  const blogCol = el('div', 'tools-internal-col');
  const blogH = document.createElement('h2');
  blogH.textContent = 'From the blog';
  blogCol.appendChild(blogH);
  const blogUl = el('ul', 'tools-link-list');
  blogUl.id = 'toolsBlogLinks';
  blogCol.appendChild(blogUl);

  const relCol = el('div', 'tools-internal-col');
  const relH = document.createElement('h2');
  relH.textContent = 'Related tools';
  relCol.appendChild(relH);
  const relUl = el('ul', 'tools-link-list');
  defaultRelatedKeys(key).forEach((rk) => {
    const p = TOOL_PAGES[rk];
    if (!p) return;
    const li = document.createElement('li');
    const a = el('a', '', { href: `tools.html?type=${encodeURIComponent(rk)}` });
    a.textContent = p.h1;
    li.appendChild(a);
    relUl.appendChild(li);
  });
  relCol.appendChild(relUl);

  internal.append(blogCol, relCol);
  root.appendChild(internal);

  loadBlogAndGuides(key);
}

function buildExpandedLoadingMount() {
  const mount = el('div', 'tools-expanded-wrap');
  mount.id = 'toolsExpandedMount';
  const loading = el('div', 'tools-expanded-loading');
  const loadingText = el('p', 'tools-expanded-loading-text');
  loadingText.textContent = 'Loading expanded guide…';
  loading.appendChild(loadingText);
  for (let i = 0; i < 5; i += 1) {
    loading.appendChild(el('div', 'tools-skeleton-line'));
  }
  const root = el('div', 'tools-expanded-root tools-prose');
  root.id = 'toolsExpandedRoot';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');
  mount.append(loading, root);
  return mount;
}

function appendProseHeading(parent, text) {
  const h2 = document.createElement('h2');
  h2.textContent = text;
  parent.appendChild(h2);
}

function appendProseParagraphs(parent, text) {
  String(text || '')
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((block) => {
      const p = document.createElement('p');
      p.textContent = block.replace(/\n/g, ' ');
      parent.appendChild(p);
    });
}

function renderExpandedInto(container, data) {
  container.textContent = '';
  const hasBody =
    (data.introExpanded && String(data.introExpanded).trim()) ||
    (data.howItWorks && String(data.howItWorks).trim()) ||
    (Array.isArray(data.benefits) && data.benefits.length) ||
    (Array.isArray(data.useCasesExpanded) && data.useCasesExpanded.length) ||
    (data.comparison && String(data.comparison).trim()) ||
    (data.tips && String(data.tips).trim()) ||
    (Array.isArray(data.faqsExpanded) && data.faqsExpanded.length);
  if (!hasBody) return;

  const section = el('section', 'tools-section tools-expanded-ai');

  if (data.introExpanded) {
    appendProseHeading(section, 'In depth');
    appendProseParagraphs(section, data.introExpanded);
  }
  if (data.howItWorks) {
    appendProseHeading(section, 'How it works');
    appendProseParagraphs(section, data.howItWorks);
  }
  if (Array.isArray(data.benefits) && data.benefits.length) {
    appendProseHeading(section, 'Benefits');
    const ul = document.createElement('ul');
    data.benefits.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    section.appendChild(ul);
  }
  if (Array.isArray(data.useCasesExpanded) && data.useCasesExpanded.length) {
    appendProseHeading(section, 'More use cases');
    const ul = document.createElement('ul');
    data.useCasesExpanded.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    section.appendChild(ul);
  }
  if (data.comparison) {
    appendProseHeading(section, 'Cutup vs. doing it manually');
    appendProseParagraphs(section, data.comparison);
  }
  if (data.tips) {
    appendProseHeading(section, 'Practical tips');
    appendProseParagraphs(section, data.tips);
  }
  if (Array.isArray(data.faqsExpanded) && data.faqsExpanded.length) {
    appendProseHeading(section, 'More questions');
    data.faqsExpanded.forEach((item) => {
      const det = el('details', 'tools-faq-item');
      const sum = document.createElement('summary');
      sum.textContent = item.question || '';
      const body = el('div', 'tools-faq-body');
      body.textContent = item.answer || '';
      det.append(sum, body);
      section.appendChild(det);
    });
  }

  container.appendChild(section);
}

async function loadExpandedToolContent(key) {
  const mount = document.getElementById('toolsExpandedMount');
  const loading = mount?.querySelector('.tools-expanded-loading');
  const root = document.getElementById('toolsExpandedRoot');
  if (!mount || !loading || !root) return;

  try {
    const res = await fetch(toolsContentUrl(key));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error('tools-content failed');
    loading.remove();
    renderExpandedInto(root, data);
    if (!root.children.length) {
      mount.remove();
      return;
    }
    root.hidden = false;
    console.log('[seo] content expanded loaded');
  } catch {
    mount.remove();
  }
}

function renderFallback(invalidType) {
  const root = document.getElementById('toolsPageRoot');
  if (!root) return;
  clearRoot(root);
  removeToolsPageJsonLd();
  document.title = invalidType ? 'Tool not found — Cutup' : 'Cutup tools';
  setMetaByName('description', 'Explore Cutup tools for transcripts, subtitles, and captions.');
  setMetaByProperty('og:title', document.title);
  setMetaByProperty('og:description', 'Explore Cutup tools for transcripts, subtitles, and captions.');
  const canonicalBase = `${window.location.origin}${window.location.pathname}`;
  setCanonical(canonicalBase);
  setMetaByProperty('og:url', canonicalBase);

  const wrap = el('div', 'tools-fallback');
  const h1 = document.createElement('h1');
  h1.textContent = invalidType ? 'This tool page was not found' : 'Cutup tools';
  const p = document.createElement('p');
  p.textContent = invalidType
    ? 'Check the URL or pick a page below.'
    : 'Choose a tool-focused landing page or open the main generator.';
  wrap.append(h1, p);
  const pills = el('div', 'tools-tool-index');
  Object.keys(TOOL_PAGES).forEach((k) => {
    const a = el('a', 'tools-pill-link', { href: `tools.html?type=${encodeURIComponent(k)}` });
    a.textContent = TOOL_PAGES[k].h1;
    pills.appendChild(a);
  });
  wrap.appendChild(pills);
  const home = el('a', 'tools-btn-primary', { href: '/' });
  home.textContent = 'Back to home';
  home.style.marginTop = '24px';
  home.style.display = 'inline-flex';
  wrap.appendChild(home);
  root.appendChild(wrap);
}

function appendLoadingRow(ul) {
  if (!ul) return;
  const placeholder = el('li', '');
  placeholder.textContent = 'Loading…';
  ul.appendChild(placeholder);
}

async function loadBlogAndGuides(toolKey) {
  const ul = document.getElementById('toolsBlogLinks');
  const guidesUl = document.getElementById('toolsRelatedGuides');
  if (!ul && !guidesUl) return;
  appendLoadingRow(ul);
  appendLoadingRow(guidesUl);

  try {
    const res = await fetch(BLOG_ENDPOINT);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('blog');
    const posts = (data.posts || []).filter((p) => p.status === 'published');
    posts.sort((a, b) => {
      const da = new Date(a.publishedAt || a.updatedAt || 0).getTime();
      const db = new Date(b.publishedAt || b.updatedAt || 0).getTime();
      return db - da;
    });
    const top = posts.filter((p) => String(p.slug || '').trim()).slice(0, 5);

    if (ul) {
      ul.textContent = '';
      top.forEach((post) => {
        const li = document.createElement('li');
        const slug = String(post.slug || '');
        const a = el('a', '', { href: `/blog.html?slug=${encodeURIComponent(slug)}` });
        a.textContent = post.title || slug;
        li.appendChild(a);
        ul.appendChild(li);
      });
      if (!ul.children.length) {
        const li = document.createElement('li');
        li.textContent = 'No posts yet — see the blog soon.';
        ul.appendChild(li);
      }
    }

    if (guidesUl) {
      guidesUl.textContent = '';
      top.slice(0, 5).forEach((post) => {
        const li = document.createElement('li');
        const slug = String(post.slug || '');
        const a = el('a', '', { href: `/blog.html?slug=${encodeURIComponent(slug)}` });
        a.textContent = guideLinkLabel(post, toolKey);
        li.appendChild(a);
        guidesUl.appendChild(li);
      });
      if (!guidesUl.children.length) {
        const li = document.createElement('li');
        const a = el('a', '', { href: '/blog.html' });
        a.textContent = 'Browse all guides on the Cutup blog';
        li.appendChild(a);
        guidesUl.appendChild(li);
      }
    }
  } catch {
    if (ul) {
      ul.textContent = '';
      const li = document.createElement('li');
      const a = el('a', '', { href: '/blog.html' });
      a.textContent = 'Visit the Cutup blog';
      li.appendChild(a);
      ul.appendChild(li);
    }
    if (guidesUl) {
      guidesUl.textContent = '';
      const li = document.createElement('li');
      const a = el('a', '', { href: '/blog.html' });
      a.textContent = 'Read guides on the Cutup blog';
      li.appendChild(a);
      guidesUl.appendChild(li);
    }
  }
}

function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const rawType = params.get('type');
  if (!rawType) {
    renderFallback(false);
    return;
  }
  const key = sanitizeTypeParam(rawType);
  const page = key ? TOOL_PAGES[key] : null;
  if (!page) {
    renderFallback(true);
    return;
  }
  renderToolPage(key, page);
}

document.addEventListener('DOMContentLoaded', bootstrap);
