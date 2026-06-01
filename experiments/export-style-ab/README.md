# Export style A/B (Hormozi params vs test-fa)

Uses **real** `export.ass` Dialogue/timing/text unchanged.

Only `[V4+ Styles]` rows are replaced: `Default`, `Emphasis`, `RTL_Default` each get the exact parameter tail from working `test-fa.ass` (72px, ScaleY=100, outline=2, etc.).

| Burn | ASS |
|------|-----|
| `export-original.mp4` | copy of input `export.ass` |
| `export-style-simple.mp4` | `export-style-simple.ass` |

## Run

```bash
# Local hormozi sample
node experiments/export-style-ab/run-style-ab.mjs

# Real failing job export.ass on server
node experiments/export-style-ab/run-style-ab.mjs \
  --input /tmp/cutup_render_XXX/export.ass \
  --input-video /tmp/cutup_render_XXX/source.mp4 \
  --outdir /tmp/style-ab-test
```

## Interpretation

- **Simple correct, original broken** → Hormozi style parameters (font size, ScaleY, outline, colours, …)
- **Both broken** → compare override tags, Script Info, or hidden metadata next
