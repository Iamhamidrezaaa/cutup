/**
 * Public blog API — PostgreSQL published posts + physical HTML at /blog/{slug}.html
 */
import { listPublicBlogPosts, getPublicBlogPostMeta } from './blog-db.js';
import { blogHtmlFileExists } from './blog-files.js';

export async function listBlogPostsHandler(_req, res) {
  try {
    const posts = await listPublicBlogPosts();
    return res.json({ ok: true, posts });
  } catch (err) {
    console.error('[blog] list failed:', err);
    return res.status(500).json({ ok: false, error: 'blog_list_failed' });
  }
}

export async function getBlogPostHandler(req, res) {
  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ ok: false, error: 'missing_slug' });
  }
  try {
    const post = await getPublicBlogPostMeta(slug);
    if (!post) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    if (!blogHtmlFileExists(slug) && post.source === 'db') {
      return res.status(404).json({
        ok: false,
        error: 'html_missing',
        message: 'Post is published in DB but HTML file is missing. Regenerate from admin.'
      });
    }
    return res.json({
      ok: true,
      post: {
        ...post,
        contentHtml: post.contentHtml || '',
        url: `/blog/${post.slug}`
      }
    });
  } catch (err) {
    console.error('[blog] get failed:', err);
    return res.status(500).json({ ok: false, error: 'blog_get_failed' });
  }
}
