/** Lightweight fuzzy matching for Help Center search */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function tokenScore(query, text, weight) {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;
  if (t.includes(q)) return weight * 1;
  const words = t.split(' ');
  let best = 0;
  for (const w of words) {
    if (!w) continue;
    if (w.startsWith(q) || q.startsWith(w)) best = Math.max(best, weight * 0.92);
    const dist = levenshtein(q, w);
    const maxLen = Math.max(q.length, w.length);
    if (maxLen <= 3 && dist <= 1) best = Math.max(best, weight * 0.85);
    if (maxLen > 3 && dist <= 2) best = Math.max(best, weight * 0.78);
    if (maxLen > 6 && dist <= 3) best = Math.max(best, weight * 0.65);
  }
  if (levenshtein(q, t.slice(0, Math.min(t.length, q.length + 4))) <= 2) {
    best = Math.max(best, weight * 0.55);
  }
  return best;
}

export function scoreHelpArticle(query, article) {
  const title = tokenScore(query, article.title, 10);
  const summary = tokenScore(query, article.summary, 5);
  const tags = (article.tags || []).reduce((s, tag) => s + tokenScore(query, tag, 4), 0);
  const category = tokenScore(query, article.category_title || article.category_slug || '', 3);
  let bodyText = '';
  if (article.body && typeof article.body === 'object') {
    bodyText = [
      article.body.content,
      ...(article.body.steps || []),
      ...(article.body.tips || []),
    ].join(' ');
  } else if (typeof article.body === 'string' && !article.body.trim().startsWith('{')) {
    bodyText = article.body;
  }
  const body = tokenScore(query, bodyText, 2);
  return title + summary + tags + category + body;
}

export function fuzzySearchArticles(query, articles, limit = 8) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];
  const scored = articles
    .map((a) => ({ article: a, score: scoreHelpArticle(q, a) }))
    .filter((x) => x.score > 0.4)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.article);
}
