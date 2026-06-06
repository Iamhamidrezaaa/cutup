# CutUp Landing Page Redesign

## 1. Full page structure

```
┌─────────────────────────────────────────────────────────┐
│ Header (site-header.js) — Start Free · How it works …   │
├─────────────────────────────────────────────────────────┤
│ SECTION 1 — Hero (#top)                                 │
│   H1: Transform Long Videos into Viral Shorts             │
│   Subheadline + Start Free CTA + quick URL input        │
├─────────────────────────────────────────────────────────┤
│ Tool (#tool) — unchanged IDs for script.js              │
│   Platform tabs · transcript · SRT · viral export       │
├─────────────────────────────────────────────────────────┤
│ SECTION 2 — Social proof (#social-proof)                │
│   Export count · creators · Creator Wall clips          │
├─────────────────────────────────────────────────────────┤
│ SECTION 3 — How it works (#how-it-works) — 4 steps      │
├─────────────────────────────────────────────────────────┤
│ SECTION 4 — Style showcase (#styles)                    │
│   5 interactive preset previews                         │
├─────────────────────────────────────────────────────────┤
│ SECTION 5 — Features (#features) — 5 cards              │
├─────────────────────────────────────────────────────────┤
│ Pricing (#pricing) — retained for conversion            │
├─────────────────────────────────────────────────────────┤
│ SECTION 6 — FAQ (#faq) + FAQPage JSON-LD                │
├─────────────────────────────────────────────────────────┤
│ SECTION 7 — Final CTA (#start)                          │
├─────────────────────────────────────────────────────────┤
│ Footer (site-footer.js)                                 │
└─────────────────────────────────────────────────────────┘
```

## 2. Component map

| Component | File | Responsibility |
|-----------|------|----------------|
| `LpHero` | `index.html` + `landing-page.css` | Headline, CTAs, quick URL |
| `CutupTool` | `index.html` + `script.js` | Core product (preserved) |
| `SocialProof` | `creator-wall/*` | Metrics + example clips |
| `LpHowItWorks` | `index.html` + `landing-page.css` | 4-step grid |
| `LpStyleShowcase` | `landing-page.js` + preset renderer | Interactive style tabs |
| `LpFeatures` | `index.html` | 5 feature cards |
| `PricingGrid` | `index.html` + `plan-display.js` | Plan cards |
| `LpFaq` | `index.html` + `script.js` accordion | SEO FAQ + schema |
| `LpFinalCta` | `index.html` + `landing-page.css` | Bottom conversion block |
| `MarketingHeader` | `site-header.js` | Nav + Google auth |

## 3. SEO strategy

| Tactic | Implementation |
|--------|----------------|
| Title / description | Keyword-rich: viral shorts, AI captions, MP4 export |
| Heading hierarchy | Single H1 in hero; H2 per section; H3 in steps/features |
| Structured data | `@graph`: WebSite, SoftwareApplication, Organization |
| FAQ schema | `FAQPage` injected from DOM via `landing-page.js` |
| OpenGraph / Twitter | `og:image`, dimensions, summary_large_image |
| Canonical | `https://cutup.shop/` |
| Sitemap | Existing `sitemap.xml` — homepage URL unchanged |
| Internal links | Header anchors: `#how-it-works`, `#styles`, `#features`, `#faq` |
| Content keywords | FAQ questions target long-tail search intent |

## 4. Conversion strategy

| Lever | Rationale |
|-------|-----------|
| **Start Free** above fold | Primary CTA → `login.html?source=hero` |
| Quick URL in hero | Immediate value; `wireHeroQuickStart()` scrolls to tool |
| Tool directly under hero | Reduces scroll friction to first action |
| Social proof before education | Trust before explaining mechanics |
| Interactive style showcase | Shows differentiation vs generic caption tools |
| Single focused feature set | 5 bullets, not 8 — reduces decision fatigue |
| Pricing before FAQ | Price-sensitive users see plans before objections |
| Final CTA repetition | Second signup moment after FAQ |
| Session-aware CTA | Logged-in users see “Open editor” → `#tool` |
| UTM-style `source` params | `hero`, `nav`, `final-cta` for analytics |

## 5. Technical implementation plan

### Done in this pass

- [x] `website/landing-page.css` — mobile-first SaaS layout
- [x] `website/landing-page.js` — showcase, FAQ schema, CTA wiring
- [x] `website/index.html` — 7 sections + SEO head
- [x] `website/site-header.js` — conversion nav

### Performance (Lighthouse 90+)

| Action | Status |
|--------|--------|
| Scoped CSS to homepage only | `landing-page.css` |
| `defer` on landing-page.js | Yes |
| Preserve tool lazy paths | No change to script.js bundle |
| Remove unused demo-sample HTML | Removed (demo-live-micro.js still loads — optional cleanup) |
| Font preconnect | Existing; consider subsetting display fonts |
| `og:image` | Static CMS hero asset |

### Follow-up (optional)

1. Remove `demo-live-micro.js` from index if no longer used
2. Add dedicated `og-landing.jpg` (1200×630) for social shares
3. A/B test hero CTA copy via `growth-optimization.js`
4. Add `hreflang` if multi-locale landing pages ship
5. Dynamic sitemap lastmod for homepage via `api/sitemap.js`

### CMS compatibility

`api/cms-page-hydrate.js` `homepageAdapter` still maps hero/tool blocks — CMS editors can override copy in hydrated slots without breaking tool IDs.
