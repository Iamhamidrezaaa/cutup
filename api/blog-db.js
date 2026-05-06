/**
 * Public blog list — merge DB + website/blog-pages/ + blog/*.html (dedupe by slug).
 * DB rows win on conflict; published editorial/HTML-only posts still appear on the index.
 */
import { listPublishedBlogPostsDb } from './billing-repository.js';
import { isBillingDbConfigured } from './db/pool.js';
import { listPublicPostsFromHtmlFiles } from './blog-files.js';
import {
  listStaticBlogArticles,
  getStaticBlogArticle,
  toListItem
} from './blog-static-registry.js';
import { readBlogPostsIndex } from './blog-index-json.js';

function mapDbPost(p) {
  return {
    id: String(p.id),
    slug: p.slug,
    title: p.title,
    titleShort: p.title,
    titleSuffix: '',
    excerpt: p.excerpt || '',
    category: p.category || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    coverImageUrl: p.coverImageUrl || '',
    publishedAt: p.publishedAt || p.updatedAt || null,
    updatedAt: p.updatedAt || p.publishedAt || null,
    readingTimeMinutes: p.readingTimeMinutes || null,
    source: 'db',
    url: `/blog/${p.slug}`,
    htmlPath: p.htmlPath || `/blog/${p.slug}.html`
  };
}

async function listFromDatabase() {
  if (!isBillingDbConfigured()) return [];
  try {
    const posts = await listPublishedBlogPostsDb(500);
    return posts.map(mapDbPost);
  } catch (err) {
    console.warn('[blog-db] DB list failed:', err?.message);
    return [];
  }
}

function enrichPostsWithBlogPagesMeta(posts) {
  return posts.map((p) => {
    const article = getStaticBlogArticle(p.slug);
    if (article && article.status === 'published') {
      return {
        ...toListItem(article),
        id: p.id,
        htmlPath: p.htmlPath,
        source: p.source || article.source || 'static'
      };
    }
    return p;
  });
}

/** Published posts from disk not yet in DB (or DB unreachable). */
function listEditorialPostsNotInDb(dbSlugs) {
  return listStaticBlogArticles().filter((p) => !dbSlugs.has(p.slug));
}

/** blog/{slug}.html without a DB row or blog-pages folder. */
function listHtmlFilePostsNotInDb(dbSlugs, editorialSlugs) {
  return listPublicPostsFromHtmlFiles().filter(
    (p) => !dbSlugs.has(p.slug) && !editorialSlugs.has(p.slug)
  );
}

export async function listPublicBlogPosts() {
  const dbPosts = await listFromDatabase();
  const dbSlugs = new Set(dbPosts.map((p) => p.slug));

  const editorialOnly = listEditorialPostsNotInDb(dbSlugs);
  const editorialSlugs = new Set(editorialOnly.map((p) => p.slug));
  const htmlOnly = listHtmlFilePostsNotInDb(dbSlugs, editorialSlugs);

  const indexOnly = readBlogPostsIndex().filter(
    (p) => !dbSlugs.has(p.slug) && !editorialSlugs.has(p.slug)
  );
  const indexSlugs = new Set(indexOnly.map((p) => p.slug));
  const htmlOnlyFiltered = htmlOnly.filter((p) => !indexSlugs.has(p.slug));

  const merged = [...dbPosts, ...editorialOnly, ...indexOnly, ...htmlOnlyFiltered];

  if (editorialOnly.length || htmlOnlyFiltered.length || indexOnly.length) {
    console.warn(
      '[blog-db] merged disk-only posts:',
      [...editorialOnly, ...indexOnly, ...htmlOnlyFiltered].map((p) => p.slug).join(', ')
    );
  }

  if (merged.length) {
    const enriched = enrichPostsWithBlogPagesMeta(merged);
    enriched.sort((a, b) => {
      const da = new Date(a.publishedAt || a.updatedAt || 0).getTime();
      const db = new Date(b.publishedAt || b.updatedAt || 0).getTime();
      return db - da;
    });
    return enriched;
  }

  return [];
}

export async function getPublicBlogPostMeta(slug) {
  const { getBlogPostBySlugDb } = await import('./billing-repository.js');
  if (isBillingDbConfigured()) {
    try {
      const post = await getBlogPostBySlugDb(slug);
      if (post && post.status === 'published') {
        return {
          ...post,
          url: `/blog/${post.slug}`,
          htmlPath: post.htmlPath || `/blog/${post.slug}.html`
        };
      }
    } catch {
      /* fall through */
    }
  }
  const fromList = (await listPublicBlogPosts()).find((p) => p.slug === slug);
  if (!fromList) return null;
  return {
    slug: fromList.slug,
    title: fromList.title,
    excerpt: fromList.excerpt,
    status: 'published',
    coverImageUrl: fromList.coverImageUrl,
    contentHtml: '',
    url: fromList.url
  };
}
