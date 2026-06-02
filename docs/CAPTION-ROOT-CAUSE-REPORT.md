# گزارش Root Cause — Caption Rendering (شواهد کد + forensic)

**وضعیت:** فقط diagnosis — هیچ fix اعمال نشده.  
**ابزار:** `CAPTION_FORENSIC=1` → لاگ `[caption-forensics]` + `[caption-forensics-report]` + فایل `{jobDir}/CAPTION-ROOT-CAUSE-REPORT.json`

---

## 1) Trace کامل (۱۰ cue اول)

در **export بعدی**، برای هر `segmentIndex` 0–9 یک خط JSON:

```json
{
  "segmentIndex": 0,
  "originalStart": 2.14,
  "originalEnd": 4.02,
  "originalText": "...",
  "translatedStart": 2.14,
  "translatedEnd": 4.02,
  "translatedText": "...",
  "mergedStart": 2.23,
  "mergedEnd": 4.17,
  "previewStart": 2.14,
  "previewEnd": 4.02,
  "previewText": "...",
  "exportStart": 2.23,
  "exportEnd": 4.17,
  "exportText": "...",
  "assDialogueStart": 2.23,
  "assDialogueEnd": 4.17,
  "assText": "..."
}
```

**منبع هر فیلد (ثابت در کد):**

| فیلد | مرحله pipeline |
|------|----------------|
| `originalStart/End/Text` | `cutupLastTranscription.segments` / `CutupSubtitleVersions.versions.original` |
| `translatedStart/End/Text` | `CutupSubtitleVersions.getActiveSegments()` (اگر ترجمه فعال) |
| `mergedStart/End` | خروجی `auditSourceAlignedPipelineStages().afterStabilize` |
| `previewStart/End/Text` | `CutupStyleRenderer` — timing خام segment، بدون burn pipeline |
| `exportStart/End/Text` | `buildSourceAlignedSubtitles()` → `canonicalSubtitles` |
| `assDialogueStart/End/Text` | `generateAssContent` → `timingAuditRows` |

---

## 2) تأخیر ~۲ ثانیه اولین زیرنویس — attribution از شواهد

گزارش export شامل `firstSubtitleDelayAttribution.evidenceRows` است — **بدون حدس**، فقط delta اندازه‌گیری‌شده بین مراحل:

| Stage | ماژول | فیلد اندازه‌گیری |
|-------|--------|------------------|
| Whisper | `api/transcribe.js` → client segments | `whisperSegments[0].start` |
| export_input_segment | `website/video-export` → `job.segments[0]` | همان start ارسالی |
| buildSourceAlignedSubtitles_parsed | `subtitle-pipeline.js` | فقط normalize |
| mergeRollingCaptionChains | `subtitle-pipeline.js:758` | `afterRollingMerge[0].start` |
| coalesceBurnPhrases | `subtitle-pipeline.js:817` | `afterCoalesce[0].start` |
| stabilizeBurnCueTiming | `subtitle-pipeline.js:858` | `+ BURN_LEAD_DELAY_SEC` (پیش‌فرض 0.09s) |
| ASS_Dialogue | `ass-generator.js` | `assDialogueStart` |
| render_queue_ffmpeg_assShift | `ffmpeg-renderer.js` + `ffmpeg-timeline.js` | `assShiftSec` (فقط اگر ≠ 0) |

**اثبات آفلاین (نمونه mock با start=2.14s):**

```
Whisper parsed start:     2.140s  (+2140ms از t=0)
mergeRolling:             2.140s  (Δ = 0ms)
coalesce:                 2.140s  (Δ = 0ms)
stabilizeBurnCueTiming:   2.230s  (Δ = +90ms از lead delay)
introducedAtStage:        "Whisper"  (چون اولین جهش >1s در Whisper است)
```

**نتیجه مبتنی بر شواهد:** اگر `originalStart` / `whisperFirstStartSec` ≈ 2s باشد، تأخیر **قبل از** `buildSourceAlignedSubtitles` وجود دارد — یعنی در **Whisper / transcript source**.  
`stabilizeBurnCueTiming` فقط ~90ms اضافه می‌کند (دیرتر، نه 2s زودتر).

اگر `afterRollingMergeCount` < `parsedCount` → ادغام rolling باعث جابجایی **متن/اندیس** cue اول می‌شود (در `evidenceRows` و `pipelineCounts` ثبت می‌شود).

---

## 3) Preview styling ≠ Export styling — اشیای style دقیق

### Preview (`CutupStyleRenderer`)

- **ماژول preset:** `website/subtitle-styles/presets/registry.js` → `PRESETS.hormozi`
- **شی capture شده در export:** `cutupCaptionForensicsPreview.previewStyleObject` (کل object از `getPreset('hormozi')`)

فیلدهای کلیدی preview (از registry):

```json
{
  "typography": { "fontFamily": "\"Anton\"...", "fontSize": "clamp(1.35rem, 5.8vw, 2rem)", "textTransform": "uppercase" },
  "layout": { "mode": "stack", "wordsPerLineMin": 2, "wordsPerLineMax": 4 },
  "emphasis": { "handler": "hormozi", "mode": "spokenWord" },
  "export": { "ass": { "fontsize": 76, "outline": 4 } }
}
```

رندر: **CSS variables** در DOM — نه ASS.

### Export (`ass-generator`)

- **ماژول preset:** `api/video-render/style-presets.js` → `hormozi` resolve می‌شود به **`alexHormozi`**
- **شی ثابت در forensic:** `styleComparison.export.styleObject`

فیلدهای کلیدی export (ثابت در کد):

```json
{
  "fontName": "Anton",
  "fontSize": 76,
  "outline": 4,
  "shadow": 3,
  "scaleY": 110,
  "marginV": 290,
  "layout": { "maxCharsPerLine": 18, "maxLines": 2, "wordsPerLineMax": 4 },
  "emphasis": { "mode": "spokenWord", "highlightColor": "&H0000E5FF&" }
}
```

رندر: **ASS inline tags** `{\\c...\\b1}` + style row — سپس ffmpeg burn.

**ثابت قطعی:** `preview.presetId === "hormozi"` ولی `export.resolvedPresetId === "alexHormozi"` — دو object جدا (CSS vs ASS fixed typography). این در `[caption-forensics-report].styleComparison` چاپ می‌شود.

---

## 4) Segmentation — تابع مسئول شکستن جمله

**متن نمونه:** `این بچه تو یه چالش شرکت کرده بود...`

### Preview (ثابت در کد)

| | |
|---|---|
| File | `website/subtitle-styles/utils/text-layout.js` |
| Chain | `layoutLines()` → **`chunkWords()`** |
| قانون | فقط `wordsPerLineMin` / `wordsPerLineMax` — **بدون** مرز معنایی |

### Export (ثابت در کد)

| | |
|---|---|
| File | `api/video-render/text-layout.js` |
| Chain | `layoutLines()` → **`layoutLinesLegacyStack()`** → `splitSemanticStack()` → `rebalanceTrailingOrphan()` → `rebalanceByLength()` → `clampToMaxLines()` |
| `SEMANTIC_SEGMENTATION_PRODUCTION` | پیش‌فرض `0` — semantic در production خاموش |

**اثبات اجرا (`node scripts/caption-pipeline-evidence.mjs`):**

```
Preview lines: ["این بچه تو یه", "چالش شرکت کرده بود..."]
Export lines:  ["این بچه تو یه", "چالش شرکت کرده بود..."]
```

برای این متن کوتاه خروجی یکسان است؛ **واگرایی production** وقتی رخ می‌دهد که:

- `maxCharsPerLine: 18` در export (export layout) vs preview بدون `maxCharsPerLine` → شکست بر اساس **طول کاراکتر** در `splitSemanticStack` / `hitCharCap`
- یا متن‌های بلند‌تر / cueهای ادغام‌شده

**ثابت:** preview هرگز `layoutLinesLegacyStack` را صدا نمی‌زند — فقط `chunkWords`.

---

## 5) جمع‌بندی root cause (فقط از شواهد بالا)

| Regression | محل معرفی‌شده در pipeline | شواهد |
|------------|---------------------------|--------|
| اولین sub ~2s دیر | **Whisper** (`originalStart` ≈ 2s) | `introducedAtStage: "Whisper"` در forensic report؛ merge نمونه Δ=0 |
| Preview ≠ Export look | **دو renderer + دو preset object** | `registry.hormozi` CSS vs `style-presets.alexHormozi` ASS |
| شکستن غیرمعنایی جمله | **Preview: `chunkWords`** / **Export: `layoutLinesLegacyStack` + char cap 18** | `segmentationProof` در report؛ `linesMatch` per job |
| Hormozi شبیه karaoke در preview | **`FakePlayerAnimator`** (اگر cinematic preview باز است) | `website/cinematic-preview/fake-player-animator.js` — چرخه 3.8s، highlight نیمه جمله؛ جدا از ASS |

---

## اجرای forensic در production

1. Transcribe + preview → Console مرورگر: `[caption-forensics]` (فیلدهای preview)
2. Export MP4 → سرور: `[caption-forensics]` ×10 + `[caption-forensics-report]`
3. فایل: `{jobDir}/CAPTION-ROOT-CAUSE-REPORT.json`

غیرفعال: `CAPTION_FORENSIC=0`
