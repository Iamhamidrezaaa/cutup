/**

 * Server-side HTML for /blog/:slug — injects SEO head + article body into blog-post.html shell.

 */

import { readFileSync, existsSync } from 'fs';

import { join, dirname } from 'path';

import { fileURLToPath } from 'url';

import { extractTocFromHtml, renderTocHtml } from './blog-toc.js';

import { canonicalBlogUrl } from './blog-files.js';



const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = join(__dirname, '..', 'website', 'blog-post.html');

let templateCache = null;



function getTemplate() {

  if (!templateCache) {

    templateCache = readFileSync(TEMPLATE_PATH, 'utf8');

  }

  return templateCache;

}



/** Remove visible "TL;DR" label; keep intro summary box. */
export function stripTldrLabels(html) {
  return String(html || '')
    .replace(/<span[^>]*class="ba-tldr-label"[^>]*>[\s\S]*?<\/span>\s*/gi, '')
    .replace(/<span[^>]*class="blog-tldr-label"[^>]*>[\s\S]*?<\/span>\s*/gi, '');
}

function escapeHtml(s) {

  return String(s ?? '')

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;');

}



function fmtDate(value) {

  if (!value) return '';

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return '';

  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

}



function buildHead(article) {

  const slug = article.slug;

  const canonical = canonicalBlogUrl(slug);

  const title = article.metaTitle || `${article.title}${article.titleSuffix ? ` ${article.titleSuffix}` : ''} — Cutup`;

  const description = article.metaDescription || article.excerpt || '';

  const ogImage = article.coverImageUrl

    ? article.coverImageUrl.startsWith('http')

      ? article.coverImageUrl

      : `https://cutup.shop${article.coverImageUrl}`

    : '';



  const jsonLd = {

    '@context': 'https://schema.org',

    '@type': 'BlogPosting',

    headline: article.title + (article.titleSuffix ? ` ${article.titleSuffix}` : ''),

    description,

    image: ogImage || undefined,

    datePublished: article.publishedAt || undefined,

    dateModified: article.updatedAt || article.publishedAt || undefined,

    author: { '@type': 'Organization', name: article.author || 'Cutup' },

    publisher: {

      '@type': 'Organization',

      name: 'Cutup',

      logo: { '@type': 'ImageObject', url: 'https://cutup.shop/logo.svg' }

    },

    mainEntityOfPage: canonical

  };



  const ldScripts = [`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`];
  if (Array.isArray(article.faqSchema) && article.faqSchema.length) {
    const faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: article.faqSchema.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer }
      }))
    };
    ldScripts.push(`<script type="application/ld+json">${JSON.stringify(faqLd)}</script>`);
  }

  return `
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:title" content="${escapeHtml(article.ogTitle || title)}">
  <meta property="og:description" content="${escapeHtml(article.ogDescription || description)}">
  <meta property="og:site_name" content="Cutup">
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(article.ogTitle || title)}">
  <meta name="twitter:description" content="${escapeHtml(article.ogDescription || description)}">
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}
  ${ldScripts.join('\n  ')}
  `.trim();

}



function renderHeroBlock(article) {

  const titleSuffix = article.titleSuffix

    ? ` <span style="color: var(--ba-muted); font-weight: 700;">${escapeHtml(article.titleSuffix)}</span>`

    : '';

  const readLabel = article.readingTimeMinutes

    ? `${article.readingTimeMinutes} min read`

    : '10 min read';



  let coverBlock;

  if (article.coverImageUrl) {

    coverBlock = `<img class="ba-hero-img" src="${escapeHtml(article.coverImageUrl)}" alt="${escapeHtml(article.heroImageAlt || article.title)}" width="1200" height="630" loading="eager" decoding="async">`;

  } else {

    coverBlock = `<div class="ba-image-placeholder ba-image-placeholder--hero" role="img" aria-label="Hero image placeholder">

      <span class="ba-image-placeholder-eyebrow">Hero image</span>

      <span class="ba-image-placeholder-text">Set coverImageUrl in meta.json</span>

    </div>`;

  }



  return `

  <header class="ba-hero">

    <span class="ba-hero-eyebrow">${escapeHtml(article.eyebrow || article.category || 'Article')}</span>

    <h1>${escapeHtml(article.title)}${titleSuffix}</h1>

    <p class="ba-hero-deck">${escapeHtml(article.deck || article.excerpt || '')}</p>

    <div class="ba-meta">

      <span class="ba-meta-author">

        <span class="ba-meta-avatar">${escapeHtml(article.authorInitials || 'CT')}</span>

        ${escapeHtml(article.author || 'Cutup')}

      </span>

      <span class="ba-meta-dot" aria-hidden="true">·</span>

      <span>Updated ${escapeHtml(fmtDate(article.updatedAt || article.publishedAt))}</span>

      <span class="ba-meta-dot" aria-hidden="true">·</span>

      <span>${escapeHtml(readLabel)}</span>

      ${article.category ? `<span class="ba-meta-dot" aria-hidden="true">·</span><span>${escapeHtml(article.category)}</span>` : ''}

    </div>

  </header>

  <div class="ba-hero-image">${coverBlock}</div>`;

}



function renderRelated(article) {

  const related = (Array.isArray(article.related) ? article.related : []).slice(0, 3);

  if (!related.length) return '';

  const cards = related

    .map(

      (r) => `

    <a class="ba-related-card" href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">

      <span class="ba-related-card-eyebrow">${escapeHtml(r.eyebrow || 'Article')}</span>

      <h3>${escapeHtml(r.title)}</h3>

      <p>${escapeHtml(r.description || '')}</p>

    </a>`

    )

    .join('');

  return `

  <section class="ba-related" aria-labelledby="related-heading">

    <h2 id="related-heading">Related reads</h2>

    <div class="ba-related-grid">${cards}</div>

  </section>`;

}



/**

 * @param {object} article — from resolveBlogArticle

 */

export function renderBlogPostPage(article) {

  if (!article) return null;

  if (!existsSync(TEMPLATE_PATH)) {

    throw new Error('blog-post.html template missing');

  }



  const bodyHtml = stripTldrLabels(article.bodyHtml || '');

  const tocItems = extractTocFromHtml(bodyHtml);

  const tocHtml = renderTocHtml(tocItems);



  let html = getTemplate();

  html = html.replace('<!--CUTUP_BLOG_HEAD-->', buildHead(article));

  html = html.replace('<!--CUTUP_BLOG_HERO-->', renderHeroBlock(article));

  html = html.replace('<!--CUTUP_BLOG_TOC-->', tocHtml);

  html = html.replace('<!--CUTUP_BLOG_BODY-->', bodyHtml || '<p>No content available.</p>');

  html = html.replace('<!--CUTUP_BLOG_RELATED-->', renderRelated(article));

  html = html.replace('<!--CUTUP_BLOG_SLUG-->', escapeHtml(article.slug));



  return html;

}


