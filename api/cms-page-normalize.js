/**
 * Defensive CMS page section normalization.
 */
const BLOCK_TYPES = new Set([
  'hero',
  'richtext',
  'features',
  'cta',
  'faq',
  'testimonials',
  'pricing',
  'stats',
  'logos',
  'split',
  'image',
  'gallery',
  'video',
  'html'
]);

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

export function normalizeCmsSections(input) {
  let arr = input;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];

  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const type = String(raw.type || '').trim().toLowerCase();
    if (!BLOCK_TYPES.has(type)) continue;

    const block = { ...raw, type };

    if (type === 'hero') {
      block.title = String(block.title || '');
      block.subtitle = String(block.subtitle || '');
      block.body = String(block.body || '');
      block.imageUrl = String(block.imageUrl || '');
      block.ctaLabel = String(block.ctaLabel || '');
      block.ctaUrl = String(block.ctaUrl || '');
    }
    if (type === 'richtext') {
      block.body = String(block.body || '');
    }
    if (type === 'features' || type === 'faq' || type === 'testimonials' || type === 'stats' || type === 'logos') {
      block.heading = String(block.heading || '');
      block.items = asArray(block.items).filter((x) => x && typeof x === 'object');
    }
    if (type === 'pricing') {
      block.heading = String(block.heading || '');
      block.intro = String(block.intro || '');
      block.footnote = String(block.footnote || '');
      block.plans = asArray(block.plans).filter((x) => x && typeof x === 'object');
    }
    if (type === 'cta') {
      block.title = String(block.title || '');
      block.text = String(block.text || '');
      block.buttonLabel = String(block.buttonLabel || '');
      block.buttonUrl = String(block.buttonUrl || '');
    }
    if (type === 'html') {
      block.label = String(block.label || '');
      block.html = String(block.html || '');
      block.note = String(block.note || '');
    }
    if (type === 'image' || type === 'video') {
      block.url = String(block.url || '');
      block.alt = String(block.alt || block.caption || '');
      block.caption = String(block.caption || '');
    }
    if (type === 'gallery') {
      block.heading = String(block.heading || '');
      block.images = asArray(block.images).filter((x) => x && typeof x === 'object');
    }
    if (type === 'split') {
      block.heading = String(block.heading || '');
      block.leftTitle = String(block.leftTitle || '');
      block.leftBody = String(block.leftBody || '');
      block.rightTitle = String(block.rightTitle || '');
      block.rightBody = String(block.rightBody || '');
      block.imageUrl = String(block.imageUrl || '');
    }

    out.push(block);
  }
  return out;
}

export function normalizePagePayload(payload = {}) {
  const sections = normalizeCmsSections(payload.sections);
  return {
    ...payload,
    title: String(payload.title || payload.slug || 'Untitled').trim(),
    slug: String(payload.slug || '').trim(),
    heroTitle: String(payload.heroTitle || '').trim(),
    heroSubtitle: String(payload.heroSubtitle || '').trim(),
    content: String(payload.content || '').trim(),
    sections,
    template: String(payload.template || 'default'),
    status: payload.status || 'draft',
    metaTitle: String(payload.metaTitle || '').trim(),
    metaDescription: String(payload.metaDescription || '').trim()
  };
}
