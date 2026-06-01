# ASS `\N` newline RTL forensic (standalone)

Tests whether **only** a hard line break (`\N`) corrupts Persian RTL, using the same minimal style as the successful server `test-fa.ass`.

| Test | Dialogue | ASS | MP4 |
|------|----------|-----|-----|
| A | `سلام دنیا` | `test-singleline.ass` | `test-singleline.mp4` |
| B | `سلام دنیا\Nخوبی؟` | `test-multiline.ass` | `test-multiline.mp4` |

Not used: Hormozi, `RTL_Default`, `export.ass`, production pipeline.

## Run

```bash
node experiments/ass-newline-rtl-ab/run-newline-ab.mjs
```

FFmpeg (same as test-fa):

```text
scale=1080:1920,ass=test-singleline.ass
scale=1080:1920,ass=test-multiline.ass
```

Compare both MP4s visually for word order and shaping.
