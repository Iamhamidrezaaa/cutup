/**
 * Write / remove physical blog HTML from DB post records.
 */
import { renderBlogPostPage } from './blog-ssr.js';
import { writeBlogHtmlFile, deleteBlogHtmlFile, blogHtmlRelativePath } from './blog-files.js';
import { resolveBlogCoverImageUrl } from './blog-static-registry.js';
import {
  getBlogPostByIdDb,
  getBlogPostBySlugDb,
  updateBlogPostHtmlPathDb
} from './billing-repository.js';

export function postRecordToArticle(post) {
  if (!post) return null;
  return {
    slug: post.slug,
    title: post.title,
    titleSuffix: post.titleSuffix || '',
    deck: post.excerpt || '',
    excerpt: post.excerpt || '',
    category: post.category || '',
    tags: post.tags || [],
    eyebrow: post.category || 'Article',
    author: post.author || 'Cutup',
    authorInitials: post.authorInitials || 'CT',
    authorRole: post.authorRole || '',
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    readingTimeMinutes: post.readingTimeMinutes || null,
    coverImageUrl: resolveBlogCoverImageUrl(post.coverImageUrl || ''),
    heroImageAlt: post.heroImageAlt || post.title || '',
    metaTitle: post.metaTitle || post.seoTitle || post.title,
    metaDescription: post.metaDescription || post.excerpt || '',
    ogTitle: post.ogTitle || post.metaTitle || post.title,
    ogDescription: post.ogDescription || post.metaDescription || '',
    bodyHtml: post.contentHtml || post.content || '',
    related: Array.isArray(post.related) ? post.related : [],
    faqSchema: Array.isArray(post.faqSchema) ? post.faqSchema : undefined
  };
}

/**
 * @param {string} idOrSlug
 * @returns {Promise<{ ok: boolean, action?: string, htmlPath?: string, error?: string }>}
 */
export async function syncBlogPostHtml(idOrSlug) {
  const post =
    (await getBlogPostByIdDb(idOrSlug)) ||
    (await getBlogPostBySlugDb(idOrSlug));
  if (!post) return { ok: false, error: 'post_not_found' };

  const slug = post.slug;

  if (post.status !== 'published') {
    deleteBlogHtmlFile(slug);
    await updateBlogPostHtmlPathDb(post.id, null);
    return { ok: true, action: 'removed', slug };
  }

  const article = postRecordToArticle(post);
  const html = renderBlogPostPage(article);
  if (!html) return { ok: false, error: 'render_failed', slug };

  const rel = writeBlogHtmlFile(slug, html);
  await updateBlogPostHtmlPathDb(post.id, rel);
  return { ok: true, action: 'written', slug, htmlPath: rel };
}

export async function removeBlogPostHtml(slug) {
  if (!slug) return;
  deleteBlogHtmlFile(slug);
}
