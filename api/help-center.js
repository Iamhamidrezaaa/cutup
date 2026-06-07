/**
 * GET /api/help?action=categories|articles|article|search|recent
 */
import { setCORSHeaders } from './cors.js';
import {
  listHelpCategories,
  listHelpArticles,
  getHelpArticle,
  searchHelpForDeflection,
  getRecentlyUpdatedArticles,
} from './help-center-repository.js';

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const action = String(req.query?.action || 'articles').trim();

    if (action === 'categories') {
      const result = await listHelpCategories();
      return res.json({ ok: true, categories: result.categories });
    }

    if (action === 'article') {
      const slug = String(req.query?.slug || '').trim();
      const result = await getHelpArticle(slug);
      if (!result.ok) return res.status(404).json({ ok: false, error: result.reason });
      return res.json({ ok: true, article: result.article });
    }

    if (action === 'search') {
      const result = await searchHelpForDeflection(req.query?.q, req.query?.limit);
      return res.json({ ok: true, articles: result.articles });
    }

    if (action === 'recent') {
      const result = await getRecentlyUpdatedArticles(req.query?.limit);
      return res.json({ ok: true, articles: result.articles });
    }

    const result = await listHelpArticles({
      category: req.query?.category,
      q: req.query?.q,
      popular: req.query?.popular === '1' || req.query?.popular === 'true',
      limit: req.query?.limit,
    });
    return res.json({ ok: true, articles: result.articles });
  } catch (err) {
    console.error('[help-center]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
