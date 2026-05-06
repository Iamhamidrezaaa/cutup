/**
 * Map live static site HTML → CMS page sections (blocks).
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const API_DIR = dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = join(API_DIR, '..', 'website');
const SNAPSHOT_DIR = join(API_DIR, 'cms-site-snapshots');

const SLUG_TO_FILE = {
  home: 'index.html',
  about: 'about.html',
  contact: 'contact.html',
  privacy: 'privacy.html',
  terms: 'terms.html'
};

const HYDRATABLE_SLUGS = new Set(Object.keys(SLUG_TO_FILE));

let lastHydrationDebug = null;

export function getLastHydrationDebug() {
  return lastHydrationDebug;
}

function pushDebug(entry) {
  lastHydrationDebug = { ...entry, at: new Date().toISOString() };
  if (typeof globalThis !== 'undefined') {
    globalThis.__cmsHydrationDebug = globalThis.__cmsHydrationDebug || { events: [], last: null };
    globalThis.__cmsHydrationDebug.events.push(lastHydrationDebug);
    globalThis.__cmsHydrationDebug.last = lastHydrationDebug;
  }
}

function readSnapshot(slug) {
  const p = join(SNAPSHOT_DIR, `${slug}.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    pushDebug({ step: 'snapshot', slug, path: p, blockCount: raw?.sections?.length || 0 });
    return raw;
  } catch (e) {
    pushDebug({ step: 'snapshot', slug, level: 'error', message: e?.message });
    return null;
  }
}

function readSiteHtml(slug) {
  const file = SLUG_TO_FILE[slug];
  if (!file) return null;
  const candidates = [
    join(WEBSITE_DIR, file),
    join(process.cwd(), 'website', file),
    join(process.cwd(), 'public', file)
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      pushDebug({ step: 'read_html', slug, path, ok: true });
      return readFileSync(path, 'utf8');
    }
  }
  pushDebug({ step: 'read_html', slug, level: 'error', reason: 'file_not_found', tried: candidates });
  return null;
}

function stripScripts(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
}

function decodeText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function innerHtml(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

function extractMeta(html) {
  const title = decodeText(innerHtml(html, /<title>([\s\S]*?)<\/title>/i));
  const metaDescription = decodeText(
    innerHtml(html, /<meta\s+name="description"\s+content="([^"]*)"/i)
  );
  return { metaTitle: title, metaDescription };
}

function parseFeatureCards(sectionHtml, iconClass = 'feature-icon') {
  const items = [];
  const cardRe = new RegExp(
    `<div class="feature-card[\\s\\S]*?<div class="${iconClass}"[^>]*>([^<]*)</div>[\\s\\S]*?<h3[^>]*>([\\s\\S]*?)</h3>[\\s\\S]*?<p[^>]*class="feature-description"[^>]*>([\\s\\S]*?)</p>`,
    'gi'
  );
  let m;
  while ((m = cardRe.exec(sectionHtml))) {
    items.push({
      icon: decodeText(m[1]),
      title: decodeText(m[2]),
      text: decodeText(m[3])
    });
  }
  return items;
}

function parseUseCaseCards(sectionHtml) {
  const items = [];
  const cardRe = /<div class="use-case-card">[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = cardRe.exec(sectionHtml))) {
    items.push({ title: decodeText(m[1]), text: decodeText(m[2]) });
  }
  return items;
}

function parseSteps(sectionHtml) {
  const items = [];
  const re =
    /<div class="step">[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p[^>]*class="step-description"[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(sectionHtml))) {
    items.push({ title: decodeText(m[1]), text: decodeText(m[2]) });
  }
  return items;
}

function parseFaqItems(sectionHtml) {
  const items = [];
  const cardRe =
    /<button[^>]*class="faq-question"[^>]*>([\s\S]*?)<\/button>[\s\S]*?<div class="faq-answer"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = cardRe.exec(sectionHtml))) {
    items.push({ q: decodeText(m[1]), a: decodeText(m[2]) });
  }
  return items;
}

function parsePricingPlans(sectionHtml) {
  const plans = [];
  const parts = String(sectionHtml || '').split(/<div class="feature-card pricing-card/gi);
  for (let i = 1; i < parts.length; i++) {
    const chunk = '<div class="feature-card pricing-card' + parts[i];
    const name = decodeText(
      innerHtml(chunk, /<h3[^>]*class="feature-title"[^>]*>([\s\S]*?)<\/h3>/i) ||
        innerHtml(chunk, /<h3[^>]*>([\s\S]*?)<\/h3>/i)
    );
    if (!name) continue;
    const priceLine = decodeText(
      innerHtml(chunk, /<p[^>]*data-cutup-plan-line[^>]*>([\s\S]*?)<\/p>/i) ||
        innerHtml(chunk, /<p[^>]*style="font-weight:\s*600[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    );
    const descParts = [];
    const descRe =
      /<p class="feature-description"(?![^>]*data-cutup)(?![^>]*pricing-micro)(?![^>]*pricing-tier)(?![^>]*pricing-access)(?![^>]*pricing-fit)[^>]*>([\s\S]*?)<\/p>/gi;
    let dm;
    while ((dm = descRe.exec(chunk))) {
      const t = decodeText(dm[1]);
      if (t && !/padding-left:\s*18px/i.test(dm[0])) descParts.push(t);
    }
    const desc = descParts.join(' ');
    const bullets = [];
    const ul = chunk.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (ul) {
      const liRe = /<li>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(ul[1]))) bullets.push(decodeText(li[1]));
    }
    const ctaLabel = decodeText(
      innerHtml(chunk, /<a[^>]*class="[^"]*btn[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    );
    const ctaUrl = innerHtml(chunk, /<a[^>]*href="([^"]*)"/i) || '';
    plans.push({ name, priceLine, description: desc, bullets, ctaLabel, ctaUrl });
  }
  return plans;
}

function sectionById(html, id) {
  const re = new RegExp(
    `<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`,
    'i'
  );
  const m = html.match(re);
  return m ? m[0] : '';
}

function sectionByClass(html, className) {
  const re = new RegExp(
    `<section[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/section>`,
    'i'
  );
  const m = html.match(re);
  return m ? m[0] : '';
}

function homepageAdapter(html) {
  const clean = stripScripts(html);
  const sections = [];

  const heroSec = sectionByClass(clean, 'hero');
  if (heroSec) {
    const eyebrow = decodeText(innerHtml(heroSec, /<p class="hero-eyebrow"[^>]*>([\s\S]*?)<\/p>/i));
    const titleRaw = innerHtml(heroSec, /<h1 class="hero-title"[^>]*>([\s\S]*?)<\/h1>/i);
    const title = decodeText(titleRaw.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, ''));
    const trust = decodeText(innerHtml(heroSec, /<p class="hero-trust-line"[^>]*>([\s\S]*?)<\/p>/i));
    const support = decodeText(innerHtml(heroSec, /<p class="hero-support-line"[^>]*>([\s\S]*?)<\/p>/i));
    const desc = decodeText(innerHtml(heroSec, /<p class="hero-description"[^>]*>([\s\S]*?)<\/p>/i));
    sections.push({
      type: 'hero',
      title,
      subtitle: [eyebrow, trust, support].filter(Boolean).join(' · '),
      body: desc,
      imageUrl: '',
      ctaLabel: 'Try the tool',
      ctaUrl: '/#tool'
    });
  }

  const toolSec = sectionByClass(clean, 'download-section');
  if (toolSec) {
    sections.push({
      type: 'html',
      label: 'Interactive tool (homepage)',
      html: '<!-- Live tool UI: YouTube / TikTok / Instagram tabs + upload. Managed in index.html script stack. -->',
      note: 'The download / transcript tool is embedded in the static homepage. Edit labels and structure in the site template or replace with a custom HTML block.'
    });
  }

  const demoSec = sectionByClass(clean, 'demo-sample');
  if (demoSec) {
    const heading = decodeText(innerHtml(demoSec, /<h2[^>]*>([\s\S]*?)<\/h2>/i));
    const lead = decodeText(innerHtml(demoSec, /<p class="demo-sample-lead"[^>]*>([\s\S]*?)<\/p>/i));
    sections.push({
      type: 'richtext',
      body: `<h2>${heading}</h2>\n<p>${lead}</p>\n<p><em>Product preview frame — visual demo cards on the live site.</em></p>`
    });
  }

  const useCases = sectionByClass(clean, 'use-cases');
  if (useCases) {
    sections.push({
      type: 'features',
      heading: decodeText(innerHtml(useCases, /<h2[^>]*>([\s\S]*?)<\/h2>/i)),
      items: parseUseCaseCards(useCases)
    });
  }

  const features = sectionById(clean, 'features');
  if (features) {
    sections.push({
      type: 'features',
      heading: decodeText(innerHtml(features, /<h2[^>]*>([\s\S]*?)<\/h2>/i)),
      items: parseFeatureCards(features)
    });
  }

  const how = sectionById(clean, 'how-it-works');
  if (how) {
    sections.push({
      type: 'stats',
      heading: decodeText(innerHtml(how, /<h2[^>]*>([\s\S]*?)<\/h2>/i)),
      items: parseSteps(how).map((s, i) => ({
        value: String(i + 1),
        label: s.title,
        text: s.text
      }))
    });
  }

  const pricing = sectionById(clean, 'pricing');
  if (pricing) {
    const intro = decodeText(
      innerHtml(
        pricing,
        /<p class="hero-description" style="text-align: center; max-width: 760px[^"]*"[^>]*>([\s\S]*?)<\/p>/i
      )
    );
    const footnote = decodeText(
      innerHtml(
        pricing,
        /<p class="hero-description" style="text-align: center; max-width: 720px[^"]*"[^>]*>([\s\S]*?)<\/p>/i
      )
    );
    sections.push({
      type: 'pricing',
      heading: decodeText(innerHtml(pricing, /<h2[^>]*>([\s\S]*?)<\/h2>/i)),
      intro,
      footnote,
      plans: parsePricingPlans(pricing)
    });
  }

  const faq = sectionById(clean, 'faq');
  if (faq) {
    sections.push({
      type: 'faq',
      heading: decodeText(innerHtml(faq, /<h2[^>]*>([\s\S]*?)<\/h2>/i)) || 'FAQ',
      items: parseFaqItems(faq)
    });
  }

  return sections;
}

function parseContentSections(html) {
  const clean = stripScripts(html);
  const main = innerHtml(clean, /<main[^>]*>([\s\S]*?)<\/main>/i) || clean;
  const sections = [];

  const h1 = decodeText(innerHtml(main, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
  const firstP = decodeText(innerHtml(main, /<p[^>]*>([\s\S]*?)<\/p>/i));
  if (h1) {
    sections.push({
      type: 'hero',
      title: h1,
      subtitle: firstP,
      imageUrl: '',
      ctaLabel: '',
      ctaUrl: ''
    });
  }

  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
  let m;
  let foundH2 = false;
  while ((m = h2Re.exec(main))) {
    foundH2 = true;
    const heading = decodeText(m[1]);
    const bodyHtml = m[2].trim();
    const paras = [];
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let p;
    while ((p = pRe.exec(bodyHtml))) paras.push(`<p>${decodeText(p[1])}</p>`);
    const listItems = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let li;
    while ((li = liRe.exec(bodyHtml))) {
      const t = decodeText(li[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, ''));
      if (t) listItems.push(`<li>${t}</li>`);
    }
    let body = `<h2>${heading}</h2>\n${paras.join('\n')}`;
    if (listItems.length) body += `\n<ul>${listItems.join('')}</ul>`;
    sections.push({ type: 'richtext', body });
  }

  if (!foundH2 && firstP) {
    sections.push({ type: 'richtext', body: `<p>${firstP}</p>` });
  }

  if (main.includes('contactForm') || main.includes('id="contactForm"')) {
    sections.push({
      type: 'html',
      label: 'Contact form',
      html: '<!-- Contact form (Turnstile + API) lives in contact.html -->',
      note: 'Form fields and submission logic remain in the static contact page template.'
    });
  }

  return sections;
}

export function buildSectionsFromSite(slug) {
  if (!HYDRATABLE_SLUGS.has(slug)) return null;
  const html = readSiteHtml(slug);
  if (!html) return null;
  if (slug === 'home') return homepageAdapter(html);
  return parseContentSections(html);
}

export function buildHydratedFields(slug) {
  const html = readSiteHtml(slug);
  if (!html) return null;
  const meta = extractMeta(html);
  const sections = buildSectionsFromSite(slug);
  if (!sections?.length) return null;

  const hero = sections.find((s) => s.type === 'hero');
  return {
    ...meta,
    heroTitle: hero?.title || '',
    heroSubtitle: hero?.subtitle || '',
    content: sections
      .filter((s) => s.type === 'richtext')
      .map((s) => s.body)
      .join('\n\n'),
    sections
  };
}

export function pageNeedsHydration(page, { force = false } = {}) {
  if (!page || !HYDRATABLE_SLUGS.has(page.slug)) return false;
  if (force) return true;
  let sections = page.sections;
  if (typeof sections === 'string') {
    try {
      sections = JSON.parse(sections);
    } catch {
      sections = [];
    }
  }
  if (!Array.isArray(sections) || sections.length === 0) return true;
  if (sections.length === 1) {
    const b = sections[0];
    if (b.type === 'hero' && !String(b.title || '').trim() && !String(b.subtitle || '').trim()) {
      return true;
    }
  }
  const hasRich = sections.some((b) => {
    if (b.type === 'hero' && String(b.title || '').trim()) return true;
    if (b.type === 'features' && (b.items || []).length) return true;
    if (b.type === 'richtext' && String(b.body || '').trim()) return true;
    if (b.type === 'faq' && (b.items || []).length) return true;
    if (b.type === 'pricing' && (b.plans || []).length) return true;
    if (b.type === 'html' && String(b.html || b.note || '').trim()) return true;
    return ['stats', 'cta', 'testimonials', 'image', 'video', 'gallery', 'logos', 'split'].includes(
      b.type
    );
  });
  return !hasRich;
}

export async function hydrateCmsPageRecord(page, { force = false } = {}) {
  if (!page || !pageNeedsHydration(page, { force })) {
    pushDebug({ step: 'skip', slug: page?.slug, reason: 'not_needed' });
    return page;
  }
  let patch = buildHydratedFields(page.slug);
  if (!patch?.sections?.length) {
    const snap = readSnapshot(page.slug);
    if (snap?.sections?.length) patch = snap;
  }
  if (!patch) {
    pushDebug({ step: 'hydrate', slug: page.slug, level: 'error', reason: 'no_patch' });
    return page;
  }
  pushDebug({
    step: 'hydrate',
    slug: page.slug,
    blockCount: patch.sections?.length,
    types: patch.sections?.map((b) => b.type),
    blocks: patch.sections
  });

  const merged = {
    ...page,
    ...patch,
    title: page.title || patch.metaTitle?.replace(/\s*—\s*Cutup.*/i, '').trim() || page.title,
    metaTitle: page.metaTitle || patch.metaTitle || '',
    metaDescription: page.metaDescription || patch.metaDescription || ''
  };

  return merged;
}
