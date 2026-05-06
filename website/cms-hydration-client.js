/**
 * Client-side page hydration fallback + debug (when API/site file path fails).
 */
window.CutupCmsHydration = (function () {
  const SLUG_URL = {
    home: '/index.html',
    about: '/about.html',
    contact: '/contact.html',
    privacy: '/privacy.html',
    terms: '/terms.html'
  };

  const HYDRATABLE = new Set(Object.keys(SLUG_URL));

  function debugLog(entry) {
    if (!window.__cmsHydrationDebug) {
      window.__cmsHydrationDebug = { events: [], last: null };
    }
    window.__cmsHydrationDebug.events.push({ ...entry, at: new Date().toISOString() });
    window.__cmsHydrationDebug.last = entry;
    if (entry.level === 'error') console.warn('[CMS Hydrate]', entry);
  }

  function decodeText(s) {
    const el = document.createElement('div');
    el.innerHTML = s;
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function stripScripts(html) {
    return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
  }

  function sectionByClass(html, className) {
    const re = new RegExp(
      `<section[^>]*class="[^"]*${className}[^"]*"[^>]*>[\\s\\S]*?<\\/section>`,
      'i'
    );
    const m = html.match(re);
    return m ? m[0] : '';
  }

  function sectionById(html, id) {
    const re = new RegExp(`<section[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/section>`, 'i');
    const m = html.match(re);
    return m ? m[0] : '';
  }

  function parseHomepage(html) {
    const clean = stripScripts(html);
    const sections = [];
    const heroSec = sectionByClass(clean, 'hero');
    if (heroSec) {
      const titleMatch = heroSec.match(/<h1[^>]*class="hero-title"[^>]*>([\s\S]*?)<\/h1>/i);
      const title = titleMatch
        ? decodeText(titleMatch[1].replace(/<[^>]+>/g, ''))
        : '';
      const eyebrow = decodeText(
        (heroSec.match(/<p class="hero-eyebrow"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
      );
      const trust = decodeText(
        (heroSec.match(/<p class="hero-trust-line"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
      );
      const support = decodeText(
        (heroSec.match(/<p class="hero-support-line"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
      );
      const desc = decodeText(
        (heroSec.match(/<p class="hero-description"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
      );
      sections.push({
        type: 'hero',
        title,
        subtitle: [eyebrow, trust, support].filter(Boolean).join(' · '),
        body: desc,
        imageUrl: '',
        ctaLabel: 'Try the tool',
        ctaUrl: '/#tool'
      });
      debugLog({ step: 'hero', level: 'info', matched: Boolean(title), title });
    } else {
      debugLog({ step: 'hero', level: 'error', reason: 'selector_miss', selector: '.hero' });
    }

    if (sectionByClass(clean, 'download-section')) {
      sections.push({
        type: 'html',
        label: 'Interactive tool (homepage)',
        html: '<!-- Live tool UI on homepage -->',
        note: 'Managed in index.html'
      });
    }

    const useCases = sectionByClass(clean, 'use-cases');
    if (useCases) {
      const items = [];
      const re = /<div class="use-case-card">[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p>([\s\S]*?)<\/p>/gi;
      let m;
      while ((m = re.exec(useCases))) {
        items.push({ title: decodeText(m[1]), text: decodeText(m[2]) });
      }
      sections.push({
        type: 'features',
        heading: decodeText((useCases.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ''),
        items
      });
    }

    const features = sectionById(clean, 'features');
    if (features) {
      const items = [];
      const re =
        /<div class="feature-card[^"]*">[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p[^>]*class="feature-description"[^>]*>([\s\S]*?)<\/p>/gi;
      let m;
      while ((m = re.exec(features))) {
        items.push({ title: decodeText(m[1]), text: decodeText(m[2]) });
      }
      sections.push({
        type: 'features',
        heading: decodeText((features.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ''),
        items
      });
    }

    const pricing = sectionById(clean, 'pricing');
    if (pricing) {
      const plans = [];
      const re = /<div class="feature-card pricing-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
      let m;
      while ((m = re.exec(pricing))) {
        const chunk = m[1];
        const name = decodeText((chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || '');
        if (!name) continue;
        plans.push({
          name,
          priceLine: decodeText(
            (chunk.match(/data-cutup-plan-line[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
          ),
          description: decodeText(
            (chunk.match(/<p class="feature-description"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
          ),
          bullets: [],
          ctaLabel: '',
          ctaUrl: ''
        });
      }
      sections.push({
        type: 'pricing',
        heading: decodeText((pricing.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ''),
        intro: '',
        footnote: '',
        plans
      });
    }

    const faq = sectionById(clean, 'faq');
    if (faq) {
      const items = [];
      const re =
        /<button[^>]*class="faq-question"[^>]*>([\s\S]*?)<\/button>[\s\S]*?<div class="faq-answer"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/gi;
      let m;
      while ((m = re.exec(faq))) {
        items.push({ q: decodeText(m[1]), a: decodeText(m[2]) });
      }
      sections.push({
        type: 'faq',
        heading: decodeText((faq.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || 'FAQ'),
        items
      });
    }

    return sections;
  }

  function parseSimplePage(html) {
    const clean = stripScripts(html);
    const main = clean.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const body = main ? main[1] : clean;
    const sections = [];
    const h1 = decodeText((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
    const firstP = decodeText((body.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
    if (h1) {
      sections.push({
        type: 'hero',
        title: h1,
        subtitle: firstP,
        body: '',
        imageUrl: '',
        ctaLabel: '',
        ctaUrl: ''
      });
    }
    const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
    let m;
    while ((m = h2Re.exec(body))) {
      const heading = decodeText(m[1]);
      const chunk = m[2];
      const paras = [];
      const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let p;
      while ((p = pRe.exec(chunk))) paras.push(`<p>${decodeText(p[1])}</p>`);
      const lis = [];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(chunk))) {
        const t = decodeText(li[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, ''));
        if (t) lis.push(`<li>${t}</li>`);
      }
      let blockBody = `<h2>${heading}</h2>\n${paras.join('\n')}`;
      if (lis.length) blockBody += `\n<ul>${lis.join('')}</ul>`;
      sections.push({ type: 'richtext', body: blockBody });
    }
    if (!sections.length && firstP) {
      sections.push({ type: 'richtext', body: `<p>${firstP}</p>` });
    }
    return sections;
  }

  function sectionsNeedHydration(sections) {
    if (!Array.isArray(sections) || !sections.length) return true;
    if (sections.length === 1) {
      const b = sections[0];
      if (b?.type === 'hero' && !String(b.title || '').trim()) return true;
    }
    const rich = sections.some((b) => {
      if (b?.type === 'hero' && String(b.title || '').trim()) return true;
      if ((b?.items || []).length) return true;
      if (b?.type === 'richtext' && b.body) return true;
      if (b?.type === 'pricing' && (b.plans || []).length) return true;
      return b?.type && !['hero', 'richtext'].includes(b.type);
    });
    return !rich;
  }

  async function hydratePage(page) {
    const slug = page?.slug;
    if (!HYDRATABLE.has(slug)) {
      debugLog({ step: 'skip', slug, reason: 'not_hydratable' });
      return page;
    }
    if (!sectionsNeedHydration(page?.sections)) {
      debugLog({ step: 'skip', slug, reason: 'already_hydrated', count: page.sections.length });
      return page;
    }

    const url = SLUG_URL[slug];
    debugLog({ step: 'fetch', slug, url });
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`fetch_${res.status}`);
      const html = await res.text();
      const sections = slug === 'home' ? parseHomepage(html) : parseSimplePage(html);
      if (!sections.length) {
        debugLog({ step: 'parse', slug, level: 'error', reason: 'no_sections' });
        return page;
      }
      debugLog({
        step: 'parsed',
        slug,
        blockCount: sections.length,
        types: sections.map((s) => s.type),
        blocks: sections
      });
      return {
        ...page,
        sections,
        _hydratedClient: true
      };
    } catch (e) {
      debugLog({ step: 'fetch', slug, level: 'error', message: e?.message || String(e) });
      return page;
    }
  }

  function mergeServerDebug(meta) {
    if (!meta) return;
    if (!window.__cmsHydrationDebug) window.__cmsHydrationDebug = { events: [], last: null };
    window.__cmsHydrationDebug.server = meta;
  }

  return { hydratePage, sectionsNeedHydration, debugLog, mergeServerDebug, HYDRATABLE };
})();
