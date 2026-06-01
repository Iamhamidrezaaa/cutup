/**
 * Preset × language ASS matrix (production generateAssContent).
 * Run: node experiments/preset-rtl-audit/run-matrix.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { listStylePresets, getStylePreset } from '../../api/video-render/style-presets.js';
import { generateAssContent } from '../../api/video-render/ass-generator.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const SAMPLES = {
  en: 'Hello world, this is a professional subtitle test.',
  fa: 'سلام دنیا، این یک تست حرفه‌ای زیرنویس است.',
  ar: 'مرحبا بالعالم، هذا اختبار ترجمة احترافية.'
};

function parseStyleLine(ass, name) {
  const line = ass.split('\n').find((l) => l.startsWith(`Style: ${name},`));
  if (!line) return null;
  const parts = line.split(',');
  return {
    font: parts[1],
    fontSize: Number(parts[2]),
    primaryColor: parts[3],
    secondaryColor: parts[4],
    outline: Number(parts[16]),
    shadow: Number(parts[17]),
    alignment: Number(parts[18]),
    spacing: Number(parts[13]),
    scaleY: Number(parts[12]),
    encoding: parts[parts.length - 1]
  };
}

function parseDialogue(ass) {
  const line = ass.split('\n').find((l) => l.startsWith('Dialogue:'));
  if (!line) return null;
  const m = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),([^,]+),/);
  return m ? { start: m[1], end: m[2], styleName: m[3] } : null;
}

const rows = [];
for (const { id, name } of listStylePresets()) {
  const base = getStylePreset(id);
  for (const [lang, text] of Object.entries(SAMPLES)) {
    const r = generateAssContent(
      [{ start: 0, end: 2.5, text, isFinal: true }],
      id,
      { playResX: 1080, playResY: 1920, captionMode: id === 'cleanSrt' ? 'accurate' : 'viral' }
    );
    const def = parseStyleLine(r.content, 'Default');
    const dlg = parseDialogue(r.content);
    const hasRtlDefault = r.content.includes('RTL_Default');
    rows.push({
      preset: id,
      presetName: name,
      language: lang,
      dialogueStyle: dlg?.styleName,
      hasRtlDefaultStyle: hasRtlDefault,
      font: def?.font,
      fontSize: def?.fontSize,
      outline: def?.outline,
      shadow: def?.shadow,
      spacing: def?.spacing,
      scaleY: def?.scaleY,
      encoding: def?.encoding,
      emphasisInDialogue: /\{\\c/.test(r.content),
      basePresetFont: base.fontName,
      baseOutline: base.outline,
      baseShadow: base.shadow,
      pass:
        !hasRtlDefault &&
        dlg?.styleName === 'Default' &&
        (lang === 'en' ? def?.font !== 'Vazirmatn' : def?.font === 'Vazirmatn')
    });
  }
}

mkdirSync(__dir, { recursive: true });
const out = { generatedAt: new Date().toISOString(), rows };
writeFileSync(join(__dir, 'matrix.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(rows, null, 2));
const failed = rows.filter((r) => !r.pass);
console.log('failed:', failed.length);
process.exit(failed.length ? 1 : 0);
