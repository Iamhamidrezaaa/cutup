# Cutup blog article authoring — agent briefing

> **After every new or updated article, always run:**
>
> ```bash
> node api/db/migrate-blog-html.mjs
> ```
>
> This writes `blog/{slug}.html`, refreshes `website/blog-posts.json` (blog index), and upserts `blog_posts` when `DATABASE_URL` is set. Preview only: `node api/db/migrate-blog-html.mjs --dry-run`. Skip DB: `node api/db/migrate-blog-html.mjs --files-only`.

## Product context

- **Site:** https://cutup.shop — AI subtitle / SRT generator for creators (YouTube, Shorts, TikTok, mobile workflows).
- **Blog URL pattern:** `https://cutup.shop/blog/{slug}`
- **Tone:** Creator-first editorial (not corporate SEO spam). Write like a creator who tested tools at 11pm before a deadline. Honest about tradeoffs. Mention competitors (VEED, Kapwing, Descript, Opus Clip) fairly; position Cutup for speed, SRT export, mobile/lightweight workflow — not as the only option.
- **Language:** English only for article body and meta fields.

## File structure (source of truth for new articles)

Create a folder:

`website/blog-pages/<slug>/`

- `meta.json` — all metadata, SEO, FAQ schema, related links
- `body.html` — inner HTML only (no `<html>`, no shell); injected into `website/blog-post.html` via `api/blog-ssr.js`

Copy from template: `website/blog-pages/_template/`

**Slug rules:** lowercase kebab-case, descriptive, often ends with `-2026` for freshness. Examples:
`how-to-generate-srt-subtitles`, `best-ai-subtitle-generators-2026`, `why-youtube-auto-captions-fail-2026`

Do NOT use folders starting with `_` (reserved for `_template`).

## meta.json — required fields

| Field | Notes |
|-------|--------|
| slug | Must match folder name |
| title, titleSuffix | H1 is `title` + optional muted `titleSuffix` |
| deck | One-line hero subtitle |
| excerpt | Card + meta description fallback (~1–2 sentences) |
| category | e.g. Guides, Tutorials |
| tags | SEO keyword array |
| eyebrow | Short label above title, e.g. "Tutorial · YouTube workflow" |
| author | Usually "Cutup Editorial" |
| authorInitials, authorRole | e.g. "CT", "Subtitle workflows · field-tested May 2026" |
| publishedAt, updatedAt | ISO dates `YYYY-MM-DD` — use recent dates so the post sorts near the top on `/blog.html` |
| readingTimeMinutes | Integer estimate |
| coverImageUrl | `/cms-media/images/blog/{slug}-cover.jpg` |
| heroImageAlt | Accessibility text |
| heroImagePrompt | (optional) For image generation — cinematic creator desk, purple-blue screen glow, 16:9, no logos/text, premium SaaS blog |
| metaTitle, metaDescription | SEO; metaDescription ~150–160 chars; title often ends with "— Cutup" |
| ogTitle, ogDescription | Social share |
| status | `"published"` or `"draft"` |
| faqSchema | (recommended) Array of `{ question, answer }` — becomes FAQPage JSON-LD |
| related | Array of `{ href, eyebrow, title, description }` — internal links to other blog posts + `/#pricing` |

## body.html — structure & CSS classes

Use semantic HTML with these **Cutup article classes** (styled in `website/blog-article.css`):

**Required / typical sections (in order):**

1. `<div class="ba-tldr">` — intro summary box only (no "TL;DR" label text; include primary keyword + soft CTA link to `/#tool`)
2. Opening `<p>` paragraphs — hook with a real creator pain story, not generic "captions are important"
3. Multiple `<h2 id="kebab-id">` sections — **every h2/h3 needs unique `id`** for auto-generated table of contents
4. Mix of: `<ul>`, `<ol>`, `<motion/div class="ba-callout">`, `<motion/div class="ba-quote">` with `<span class="ba-quote-attr">`
5. `<pre class="ba-code"><code>` for code/SRT examples
6. `<motion/div class="ba-comparison">` with `<table>` for tool comparisons
7. `<motion/div class="ba-tool-card">` blocks when reviewing individual tools
8. `<motion/div class="ba-image-placeholder">` for screenshots not yet added (describe what screenshot should show)
9. **One** `<aside class="ba-cta">` mid-article — eyebrow + title, button `href="/#tool"` "Try Cutup"
10. `<motion/div class="ba-verdict">` — "Our take" summary before FAQ
11. `<h2 id="faq">` + `<motion/div class="ba-faq">` with `<motion/div class="ba-faq-item">` per Q (mirror `faqSchema` in meta.json)
12. (optional) `<h2 id="sharing-this-guide">` with distribution notes for Reddit/Twitter — editorial only, not shown to readers as marketing

**Internal linking:** Link to existing posts under `/blog/{slug}`. Cross-link related topics (SRT guides ↔ tool comparisons ↔ YouTube auto-caption failures ↔ mobile/Safari issues).

**Length:** ~2,500–4,000 words for pillar guides; `readingTimeMinutes` 8–12.

**Keywords:** Weave naturally (bold with `<strong>` sparingly): e.g. generate SRT subtitles, AI subtitle generator, YouTube captions, subtitle workflow, SRT export, mobile subtitles.

## Cover image

- Path: `website/cms-media/images/blog/{slug}-cover.jpg`
- **Must be 1920×1080 (16:9)** — normalize with `scripts/normalize-blog-cover.ps1`
- Use `heroImagePrompt` in meta when generating art

## Build / publish pipeline

After creating `meta.json` + `body.html`:

```bash
node api/db/migrate-blog-html.mjs
node api/db/migrate-blog-html.mjs --dry-run   # preview only
```

Outputs:

- `blog/{slug}.html` — public post HTML (repo root)
- `website/blog-posts.json` — index for `/blog.html` (merged by API + client)
- `blog_posts` rows when `DATABASE_URL` is set

Public URLs:

- Post: `https://cutup.shop/blog/{slug}`
- Index: `https://cutup.shop/blog.html`

Architecture doc: `BLOG_ARCHITECTURE.md`

**Deploy checklist:** ship `website/blog-pages/`, `blog/*.html`, `website/blog-posts.json`, cover images, and restart Node so `/api/blog/posts` picks up changes.

Alternative: save via admin CMS → DB + `syncBlogPostHtml` (same SSR renderer).

## Existing articles (avoid duplicate topics; link instead)

- best-ai-subtitle-generators-2026
- how-to-generate-srt-subtitles
- why-youtube-auto-captions-fail-2026
- best-subtitle-workflow-youtube-shorts-2026
- add-captions-tiktok-videos-2026
- clean-subtitles-increase-watch-time-2026
- free-vs-paid-ai-subtitle-tools-2026
- subtitle-workflows-mobile-2026
- turn-long-videos-into-shorts-2026
- real-problem-ai-video-editing-tools-2026
- fastest-way-turn-podcasts-into-shorts-2026
- editing-shorts-entirely-on-mobile-2026
- best-subtitle-styles-for-tiktok-2026
- why-ai-subtitle-tools-feel-slow-2026
- why-mobile-subtitle-apps-break-on-safari-2026
- why-subtitle-timing-always-looks-off-2026
- best-free-caption-apps-for-creators-2026
- why-short-form-videos-lose-retention-fast-2026

## Reference example (best quality)

Read these before writing a new post:

- `website/blog-pages/how-to-generate-srt-subtitles/meta.json`
- `website/blog-pages/how-to-generate-srt-subtitles/body.html`
- `website/blog-pages/best-ai-subtitle-generators-2026/` (comparison style)

## Deliverables per article

1. `website/blog-pages/<slug>/meta.json`
2. `website/blog-pages/<slug>/body.html`
3. (optional) cover image path + prompt
4. **Run:** `node api/db/migrate-blog-html.mjs`

## Do NOT

- Wrap body in full HTML document
- Use generic AI filler ("In today's digital landscape...")
- Oversell Cutup — compare honestly
- Skip `id` on headings (breaks TOC)
- Forget `faqSchema` + matching FAQ section
- Add "TL;DR" label text in `ba-tldr` boxes
- More than 3 items in `related` array (SSR shows max 3)
- Skip `migrate-blog-html.mjs` after editorial changes

## Note on docs

`website/blog-pages/DEPRECATED.md` says the folder is archived; `BLOG_ARCHITECTURE.md` and production still treat it as the editorial source. New posts are created here, then migrated.
