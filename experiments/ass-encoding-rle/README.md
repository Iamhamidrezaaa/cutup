# ASS Encoding + RLE experiment (isolated)

**Sentence (all variants):** `من آماده هستم`

Not connected to production `api/video-render` pipeline.

## Variants

| File | Style `Encoding` | Dialogue prefix |
|------|------------------|-----------------|
| `test-a.ass` | 1 | plain text |
| `test-b.ass` | 0 | plain text |
| `test-c.ass` | 1 | U+202B RLE |
| `test-d.ass` | 0 | U+202B RLE |

## Run

```bash
cd experiments/ass-encoding-rle
node generate-variants.mjs
node run-burn-tests.mjs
```

Outputs: `test-a.mp4` … `test-d.mp4`, `manifest.json`, `results.json`.

## FFmpeg command (per variant, cwd = this folder)

```bash
ffmpeg -hide_banner -y \
  -f lavfi -i color=c=#1a1a1a:s=1080x1920:d=4:r=30 \
  -vf "scale=1080:1920,ass=test-a.ass" \
  -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -an \
  test-a.mp4
```

Replace `test-a.ass` / `test-a.mp4` with b/c/d.

## Record winner

Edit `RESULTS.md` after visual check:

```markdown
Correct variant: _ (A/B/C/D)
Word order: OK / reversed
Glyphs: OK / broken
```
