# Export ASS Encoding A/B (temporary forensic)

Compares **production** `generateAssContent()` output with **only** `Encoding` changed on `[V4+ Styles]` lines:

| File | Style `Encoding` | Burn output |
|------|------------------|-------------|
| `export.ass` | 1 (production default) | `test-encoding1.mp4` |
| `export-encoding0.ass` | 0 (patched) | `test-encoding0.mp4` |

Dialogue text, margins, font, and all other fields are identical.

## Run (Linux server with ffmpeg + fonts)

```bash
cd "e:/Machine Learning/cutup"

# Synthetic background (no video file)
node experiments/export-encoding-ab/run-encoding-ab.mjs

# Real clip (recommended)
node experiments/export-encoding-ab/run-encoding-ab.mjs \
  --input /tmp/cutup_render_XXX/source.mp4 \
  --outdir /tmp/encoding-ab-test
```

Optional: `EXPORT_PRESET=hormozi` (default) or `cleanSrt`.

## Outputs

- `export.ass`
- `export-encoding0.ass`
- `test-encoding1.mp4`
- `test-encoding0.mp4`
- `manifest.json` (style Encoding diff + ffmpeg commands)

## FFmpeg filter (both runs)

```text
scale=1080:1920,ass=<basename.ass>
```

`cwd` = output directory (same as production burn).
