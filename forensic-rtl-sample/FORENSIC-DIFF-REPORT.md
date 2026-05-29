# گزارش forensic: Cutup ASS در برابر SRT مستقیم (FFmpeg)

**تاریخ:** 2026-05-28  
**محدودیت:** بدون تغییر در کد اپلیکیشن (`api/`, `website/`). فقط تحلیل و آرتیفکت‌های تشخیصی.  
**وضعیت رندر ویدئو A/B:** روی این ماشین (Windows) `ffmpeg` و فایل ویدئو نمونه موجود نبود — بخش ویدئو باید روی سرور render (جایی که burn واقعی انجام می‌شود) اجرا شود.

---

## خلاصه اجرایی

مسیر **کارا** (تأییدشده توسط شما): `subtitles=file.srt` + `force_style=Fontname=Vazirmatn` — متن SRT خام، بدون تگ inline، BiDi توسط libass/fribidi.

مسیر **خراب** (فقط داخل Cutup): ASS تولیدشده با **تگ override قبل از متن RTL** (`{\an2\fn Vazirmatn}` + U+202B RLE)، **فیلتر متفاوت** (`scale` + `original_size`)، **زمان‌بندی پس از `stabilizeBurnCueTiming`**، و **استایل ASS غنی** (Encoding=1، ScaleY=112، MarginV=292، …).

**مظنون اصلی برای شکست RTL (بدون اجرای A/B ویدئویی محلی):** قرار گرفتن بلوک `\an2\fn …` **قبل** U+202B و متن فارسی — همان الگوی [libass #318](https://github.com/libass/libass/issues/318) که در کامنت‌های `ass-generator.js` هم ذکر شده ولی در `buildRtlDialogueText` هنوز اعمال می‌شود.

---

## آرتیفکت‌های تولیدشده

| فایل | توضیح |
|------|--------|
| `sample-source.srt` | SRT ورودی منطقی (۲ cue فارسی) |
| `cutup-generated.ass` | خروجی `generateAssContent(..., 'cleanSrt')` |
| `forensic-report.json` | JSON ساخت‌یافته (فیلتر، دستورات، استایل‌ها، ۲۰ Dialogue اول) |
| `ffmpeg-cutup-command.sh` | دستور نمایشی مسیر A |
| `ffmpeg-srt-command.sh` | دستور نمایشی مسیر B |
| `run-forensic-snapshot.mjs` | اسکریپت یک‌باره برای بازتولید آرتیفکت‌ها (خارج از `api/`) |

بازتولید:

```bash
node forensic-rtl-sample/run-forensic-snapshot.mjs
```

---

## ۱) PlayResX / PlayResY

| منبع | PlayResX | PlayResY |
|------|----------|----------|
| Cutup ASS (`cutup-generated.ass`) | **1080** | **1920** |
| مسیر SRT مستقیم | *(تعریف نشده — libass از ابعاد فریم ویدئو استفاده می‌کند)* |

Cutup همیشه قبل از burn با `scale=1080:1920` و `original_size=1080x1920` هم‌تراز می‌کند (`ffmpeg-timeline.js` → `buildAlignedVideoFilter`).

---

## ۲) فونت‌های استفاده‌شده در Style

از `[V4+ Styles]` فایل ASS:

| Style | Fontname | Fontsize | Alignment | MarginV | Encoding | ScaleY | Outline |
|-------|----------|----------|-----------|---------|----------|--------|---------|
| Default | Vazirmatn | 72 | 2 | 292 | **1** | 112 | 2 |
| Emphasis | Vazirmatn | 78 | 2 | 292 | **1** | 112 | 2 |
| RTL_Default | Vazirmatn | 72 | 2 | 292 | **1** | 112 | 2 |

مسیر SRT (`force_style`): فقط `Fontname=Vazirmatn,Alignment=2` — بدون Encoding صریح، بدون ScaleY/outline/margin از preset Cutup.

---

## ۳) بخش کامل Style (Cutup)

```
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Vazirmatn,72,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,112,2,0,1,2,0,2,140,140,292,1
Style: Emphasis,Vazirmatn,78,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,-1,0,0,0,100,112,2,0,1,2,0,2,140,140,292,1
Style: RTL_Default,Vazirmatn,72,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,112,2,0,1,2,0,2,140,140,292,1
```

---

## ۴) ۲۰ خط Dialogue اول (Cutup — در نمونه فقط ۲ خط)

```
Dialogue: 0,0:00:00.59,0:00:03.57,RTL_Default,,0,0,0,,{\an2\fn Vazirmatn}‫برای اولین بار در باشگاه ورزشی
Dialogue: 0,0:00:03.58,0:00:06.20,RTL_Default,,0,0,0,,{\an2\fn Vazirmatn}‫من آماده هستم
```

**تحلیل بایت متن Dialogue (cue 1):**

| بخش | مقدار |
|-----|--------|
| Override block | `{\an2\fn Vazirmatn}` |
| بعد از override | U+202B (RLE) سپس متن فارسی logical |
| `\pos` | **ندارد** (عمدی برای RTL) |
| Style رویداد | `RTL_Default` |
| MarginV رویداد | `0` (margin از Style: 292) |

مسیر SRT — همان cue:

```
برای اولین بار در باشگاه ورزشی
```

(بدون override، بدون RLE در فایل؛ libass خودش BiDi را اعمال می‌کند.)

---

## ۵) زمان‌بندی: SRT ورودی vs ASS تولیدشده

| Cue | SRT (ورودی) | ASS Dialogue (Cutup) | Δ start | Δ end |
|-----|-------------|----------------------|---------|-------|
| 1 | 0.500 → 3.200 | 0.59 → 3.57 | **+0.09s** | **+0.37s** |
| 2 | 3.500 → 6.000 | 3.58 → 6.20 | **+0.08s** | **+0.20s** |

علت در کد: `buildSourceAlignedSubtitles` → `stabilizeBurnCueTiming` با `RENDER_BURN_LEAD_DELAY_SEC` پیش‌فرض **0.09s** و tail pad (`subtitle-pipeline.js`). این روی **سینک** اثر می‌گذارد ولی معمولاً **جهت/شکل حروف** را خراب نمی‌کند — برای RTL forensic جدا از BiDi است.

---

## ۶) رشته فیلتر زیرنویس FFmpeg

### A) Cutup (فعلی)

```
scale=1080:1920,subtitles=subtitles.ass:original_size=1080x1920
```

- `cwd` هنگام burn = پوشهٔ فایل ASS (`ffmpeg-renderer.js`)
- نام فایل در فیلتر = **basename** فقط
- اگر `assShiftSec ≠ 0` و correction فعال باشد: فایل `.timeline-aligned.ass` با زمان‌های جابه‌جا (`shiftAssFileTimestamps`)

### B) SRT مستقیم (تست کارا)

```
subtitles=sample-source.srt:force_style='Fontname=Vazirmatn,Alignment=2'
```

**تفاوت‌های ساختاری فیلتر:**

| ویژگی | Cutup ASS | SRT مستقیم |
|--------|-----------|------------|
| `scale` | بله 1080×1920 | خیر (در دستور نمونه) |
| `original_size` | بله | خیر |
| `force_style` | خیر | بله (محدود) |
| فرمت فایل | ASS v4+ | SRT |
| تگ inline در متن | بله (`\an2`, `\fn`, RLE) | خیر |

---

## ۷) دستورات FFmpeg کامل (قالب)

### A — Cutup export

```bash
cd /path/to/job/dir   # همان پوشه subtitles.ass
ffmpeg -hide_banner -y \
  -i INPUT.mp4 \
  -vf "scale=1080:1920,subtitles=subtitles.ass:original_size=1080x1920" \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac \
  OUT_cutup_ass.mp4
```

### B — SRT control

```bash
ffmpeg -hide_banner -y \
  -i INPUT.mp4 \
  -vf "subtitles=sample-source.srt:force_style='Fontname=Vazirmatn,Alignment=2'" \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac \
  OUT_srt_direct.mp4
```

برای مقایسه عادلانه‌تر روی سرور، نسخهٔ B را با همان scale اضافه کنید:

```bash
-vf "scale=1080:1920,subtitles=sample-source.srt:force_style='Fontname=Vazirmatn,Alignment=2'"
```

تا تفاوت `scale`/`original_size` از معادله حذف شود و فقط ASS vs SRT بماند.

---

## ۸) جدول diff ساختاری (ریشهٔ احتمالی باگ RTL)

| # | بعد | SRT مستقیم (کارا) | Cutup ASS (خراب) | ارتباط با RTL |
|---|------|-------------------|------------------|----------------|
| 1 | فرمت | SRT | ASS | متوسط |
| 2 | متن Dialogue | فارسی خالص | `{\an2\fn Vazirmatn}` + U+202B + فارسی | **بالا** (#318) |
| 3 | `\fn` در Dialogue | خیر | بله (تکرار Style) | **بالا** |
| 4 | `\an2` در Dialogue | خیر (فقط force_style) | بله | متوسط |
| 5 | U+202B در فایل | خیر | بله | **بالا** (ممکن است با override تداخل کند) |
| 6 | `\pos` | خیر | خیر برای RTL؛ **بله برای LTR** | — |
| 7 | Encoding در Style | implicit | **1** روی همه Styleها | متوسط |
| 8 | ScaleY | 100 (پیش‌فرض libass) | **112** | پایین |
| 9 | MarginV | پیش‌فرض | **292** (+ Dialogue margin 0) | پایین (layout) |
| 10 | فیلتر FFmpeg | scale + original_size | بدون scale در تست شما | پایین |
| 11 | زمان cue | خام segment | +lead delay / tail pad | سینک، نه شکل حروف |
| 12 | پipeline متن | همان segment | `buildSourceAlignedSubtitles` + … | فقط اگر متن عوض شود |

---

## ۹) مسیر کد (مرجع، بدون تغییر)

| مرحله | فایل | رفتار مرتبط با forensic |
|--------|------|-------------------------|
| SRT/segment → canonical | `subtitle-pipeline.js` | `buildSourceAlignedSubtitles`, `stabilizeBurnCueTiming` |
| ASS | `ass-generator.js` | `buildRtlDialogueText`, `RTL_Default`, `Encoding=1` |
| Burn | `render-queue.js` → `ffmpeg-renderer.js` | `generateAssContent` → `subtitles.ass` → `burnSubtitles` |
| فیلتر | `ffmpeg-timeline.js` | `buildAlignedVideoFilter`, `shiftAssFileTimestamps` |

نمونهٔ RTL dialogue builder (همان چیزی که در ASS ذخیره شد):

```297:301:api/video-render/ass-generator.js
function buildRtlDialogueText(assBodyText, fontName) {
  const rtlFont = fontName || resolveRtlFontName();
  const rtlTag = `{\\an2\\fn ${rtlFont}}`;
  const lines = String(assBodyText || '').split('\\N');
  return rtlTag + RTL_RLE + lines.join(`\\N${RTL_RLE}`);
}
```

---

## ۱۰) چک‌لیست اجرای A/B روی سرور production

در پوشهٔ یک job واقعی (بعد از یک render):

```bash
JOB=/path/to/job
cp "$JOB/subtitles.ass" "$JOB/forensic-cutup.ass"
# اگر وجود داشت:
cp "$JOB/subtitles.timeline-aligned.ass" "$JOB/forensic-cutup-shifted.ass" 2>/dev/null || true
cp "$JOB/source.srt" "$JOB/forensic-source.srt"  # یا export SRT از segments

# B — همان SRT
ffmpeg -y -i video.mp4 \
  -vf "scale=1080:1920,subtitles=forensic-source.srt:force_style='Fontname=Vazirmatn,Alignment=2'" \
  -c:v libx264 -preset fast -crf 23 -c:a copy \
  "$JOB/OUT_srt_direct.mp4"

# A — از لاگ render یا burn trace
# معمولاً همان فیلتر scale+subtitles=basename.ass:original_size=...
```

سپس:

```bash
fc-list :lang=fa | head
ffmpeg -filters 2>&1 | grep subtitles
diff -u forensic-source.srt <(grep -v '^;' forensic-cutup.ass)  # فقط برای دید کلی
```

**تأیید نهایی RTL:** فریم‌گرفتن از هر دو MP4 در وسط cue 1 و مقایسهٔ visual + `ffprobe` برای streamها.

---

## ۱۱) نتیجه‌گیری forensic

1. **متن SRT شما درست است** — در نمونه، ASS همان متن منطقی را دارد؛ مشکل «محتوای اشتباه» در SRT نیست.
2. **فونت در Style درست است** (Vazirmatn، Encoding=1).
3. **تفاوت قطعی Cutup نسبت به مسیر کارا:** (الف) فرمت ASS، (ب) **override inline قبل از RLE**، (ج) فیلتر `scale`+`original_size`، (د) زمان‌بندی stabilized، (ه) استایل غنی‌تر از `force_style`.
4. **برای aisle RTL:** قوی‌ترین فرضیه = **(ب)** مطابق libass #318؛ SRT مسیر بدون هیچ `\an`/`\fn` قبل از متن است و libass BiDi را یک‌بار درست اعمال می‌کند.
5. **رندر ویدئو A/B در این workspace انجام نشد** — ffmpeg نصب نیست و `INPUT.mp4` در repo نیست.

---

## ۱۲) پیشنهاد گام بعد (فقط برای شما — خارج از این task)

وقتی A/B روی سرور انجام شد، اگر B درست و A خراب بود:

- تست ASS با Dialogue **فقط** `RTL_Default` + متن خام (بدون `{\an2\fn …}` و بدون RLE دستی)، یا
- تست ASS با RLE **بدون** هیچ override قبل از متن.

این‌ها **اصلاح کد نیست** در این سند؛ فقط experiment برای تأیید فرضیه #318.

---

*گزارش تولیدشده توسط `run-forensic-snapshot.mjs` + بازبینی استاتیک `api/video-render/*`.*
