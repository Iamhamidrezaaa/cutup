# Help Center article images

Each article uses **two** images:

| File | Where it appears |
|------|------------------|
| `{slug}-hero.jpg` | Top of the article (below title) |
| `{slug}-inline.jpg` | Middle of the article (after step-by-step guide) |

## Regenerate all images (SVG + JPG)

```bash
npm run help:illustrations
```

This creates `{slug}-hero.jpg` and `{slug}-inline.jpg` for all 48 articles (96 files total).
SVG sources are kept as fallback.

## Replace with real dashboard screenshots

1. Take a screenshot from Cutup that matches the article topic.
2. Save as JPG with the **exact same filename** (e.g. `translate-captions-hero.jpg`).
3. Drop into this folder — no code changes needed.
4. Recommended size: **1400×780px** (16:9).

## All article slugs

See `api/help-center-content.js` — examples: `dashboard-overview`, `translate-captions`, `export-mp4`, `upgrade-plan`.
