# Caption Forensics — Root Cause Report

**Scope:** Caption rendering only (no translation changes).  
**Instrument:** `[caption-forensics]` logs for first **10 cues** per job/preview refresh.

---

## Pipeline trace

```
Whisper transcript segments
  → (optional) translate-srt (text only; timestamps preserved)
  → Client preview: CutupStyleRenderer + chunkWords
  → Export request: job.segments
  → buildSourceAlignedSubtitles (rolling merge → coalesce → stabilizeBurnCueTiming)
  → ass-generator: layoutLinesLegacyStack + Hormozi ASS tags
  → ffmpeg ass burn-in
```

---

## Regression 1 — First subtitle ~2 seconds late

### Observation
First visible caption appears noticeably after speech starts.

### Root cause (primary)
**Whisper first-segment `start` is often > 1.5s** — silence/intro before first detected speech. Preview and export both inherit this timestamp from source segments. This is documented in `api/timing-origin-investigation.js` as `whisper_first_segment_late`.

### Root cause (secondary, export-only)
If rolling captions were merged (`mergeRollingCaptionChains`), the **first visible phrase** may start at a **later rolling chunk** when early fragments collapse. Input cue count can drop (`[burn-caption-collapse]`).

### Not the cause
- `BURN_LEAD_DELAY_SEC` (default **0.09s**) adds ~90ms **later** appearance on export — not 2 seconds.
- Export does not apply a fixed 2s global offset.

### Forensic signals
```json
{
  "cueIndex": 0,
  "originalStart": 2.14,
  "previewStart": 2.14,
  "exportStart": 2.23,
  "previewExportStartDeltaMs": 90
}
```
If `originalStart ≈ previewStart ≈ 2s` → source timing, not renderer bug.

---

## Regression 2 — Preview styling ≠ export styling

### Observation
Hormozi (and other presets) look different in styled preview vs burned MP4.

### Root cause
**Two independent render stacks:**

| Layer | Preview | Export |
|-------|---------|--------|
| Layout | `website/subtitle-styles/utils/text-layout.js` → `chunkWords` | `api/video-render/text-layout.js` → `layoutLinesLegacyStack` |
| Typography | CSS vars (`--cutup-font`, `--cutup-size`, …) | ASS styles (`Anton` 76px, outline, shadow, scaleY) |
| Preset ID | `hormozi` (registry) | `hormozi` → `alexHormozi` (style-presets) |
| Emphasis | CSS classes `cutup-em--hormozi` | ASS inline `{\\c&color\\b1}word{\\r}` |
| RTL | Vazirmatn override in DOM | ASS RTL style row, no inline emphasis |
| Timing | Raw `seg.start` / `seg.end` | Post-merge + `stabilizeBurnCueTiming` |

Preview never runs the export subtitle pipeline; export never reads DOM CSS.

### Forensic signals
- `segmentationMatch: false` on most cues
- `previewExportStartDeltaMs` non-zero after merge/stabilize
- Different `segmentedLines.preview` vs `segmentedLines.export`

---

## Regression 3 — Caption segmentation breaks phrases

### Observation
Lines break mid-phrase unnaturally in preview or export.

### Root cause (preview)
**`chunkWords`** splits purely by min/max words per line — no pause/semantic edge detection.

### Root cause (export)
**`layoutLinesLegacyStack`** uses `splitSemanticStack` + rebalance (stronger than preview) but still **not aligned with preview**. With `SEMANTIC_SEGMENTATION_PRODUCTION=0` (default), semantic segmentation does not run in production export.

### Result
Preview and export **both** can break phrases differently; user sees inconsistency plus bad breaks.

### Forensic signals
```json
"segmentedLines": {
  "preview": ["این یک جمله", "کامل نیست"],
  "export": ["این یک", "جمله کامل نیست"]
},
"segmentationMatch": false
```

---

## Regression 4 — Hormozi preview looks like karaoke

### Observation
Preview animates word highlights in a karaoke-like way; export Hormozi is static emphasis.

### Root cause
**`FakePlayerAnimator`** (`website/cinematic-preview/fake-player-animator.js`):
- Cycles cues every **3.8s** (not real video sync)
- Highlights **second half of sentence** via CSS (`cutup-fake-caption-hi`)
- Does **not** use word-level Whisper timing

**Styled list preview** (`CutupStyleRenderer`):
- Uses `spokenWord` mode — one word highlighted for **full cue duration** (static)

**Export** (`ass-generator` + `emphasis-engine.js`):
- One `spokenWord` per cue via ASS color/bold tags
- **No `\k` karaoke tags** (`applyFutureVisualExtensions` is no-op)

The “karaoke” feel is almost always the **fake cinematic player**, not Hormozi preset logic.

### Forensic signals
- `previewRenderer: "FakePlayerAnimator"` vs `"CutupStyleRenderer"`
- Export `exportRenderer: "ass-generator+ffmpeg-burn"`

---

## How to capture logs

1. Enable (default on): `CAPTION_FORENSIC=1`
2. After transcribe/translate: open styled preview → browser console shows `[caption-forensics]` (preview fields)
3. Export MP4 → server logs merged rows + `[caption-forensics-summary]`
4. Job artifact: `{jobDir}/caption-forensics.json`

---

## Summary table

| Symptom | Where it diverges | Primary root cause |
|---------|-------------------|-------------------|
| ~2s late first sub | Source vs expectation | Whisper first `start` > 0 (silence) |
| Preview ≠ export look | Preview DOM vs ASS burn | Separate layout + typography stacks |
| Bad line breaks | Segmentation | chunkWords (preview) vs legacyStack (export); not unified |
| Karaoke Hormozi | Cinematic fake player | FakePlayerAnimator timed cycle + mid-word CSS highlight |

**No fixes applied in this phase — instrumentation and diagnosis only.**
