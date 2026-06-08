# Help Center article images

Each article uses **two** images:

| File | Where it appears |
|------|------------------|
| `{slug}-hero.png` | Top of the article (below title) |
| `{slug}-inline.png` | Middle of the article (after step-by-step guide) |

## Upload your own screenshots

1. Take a screenshot from the Cutup dashboard that matches the article topic.
2. Save as PNG with the exact names above (e.g. `translate-captions-hero.png`).
3. Place files in this folder: `website/help-illustrations/articles/`
4. Recommended size: **1400×780px** or similar 16:9 aspect ratio.

The UI tries `.png` first, then falls back to the generated `.svg` if PNG is missing.

## Regenerate SVG placeholders

```bash
node scripts/generate-help-illustrations.mjs
```

This creates `{slug}-hero.svg` and `{slug}-inline.svg` for all 48 articles.

## All article slugs

See `api/help-center-content.js` — examples: `dashboard-overview`, `translate-captions`, `export-mp4`, `upgrade-plan`.
