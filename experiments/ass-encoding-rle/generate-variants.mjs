/**
 * Isolated ASS encoding/RLE experiment — not part of production pipeline.
 * Sentence: من آماده هستم
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SENTENCE = 'من آماده هستم';
const RLE = '\u202B';

const variants = [
  { id: 'a', label: 'Encoding=1', encoding: 1, rle: false, outAss: 'test-a.ass', outMp4: 'test-a.mp4' },
  { id: 'b', label: 'Encoding=0', encoding: 0, rle: false, outAss: 'test-b.ass', outMp4: 'test-b.mp4' },
  { id: 'c', label: 'Encoding=1 + RLE', encoding: 1, rle: true, outAss: 'test-c.ass', outMp4: 'test-c.mp4' },
  { id: 'd', label: 'Encoding=0 + RLE', encoding: 0, rle: true, outAss: 'test-d.ass', outMp4: 'test-d.mp4' }
];

function buildAss(encoding, dialogueText) {
  return [
    '[Script Info]',
    'Title: Cutup ASS Encoding RLE Experiment',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: RTL_Test,Vazirmatn,72,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,2,0,2,140,140,292,${encoding}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.50,0:00:04.00,RTL_Test,,0,0,0,,${dialogueText}`,
    ''
  ].join('\n');
}

mkdirSync(__dir, { recursive: true });

const manifest = [];

for (const v of variants) {
  const dialogueText = v.rle ? `${RLE}${SENTENCE}` : SENTENCE;
  const assPath = join(__dir, v.outAss);
  const content = buildAss(v.encoding, dialogueText);
  writeFileSync(assPath, content, 'utf8');

  const codepoints = [...dialogueText].map((c) => {
    const cp = c.codePointAt(0);
    if (cp >= 0x202a && cp <= 0x202e) return `U+${cp.toString(16).toUpperCase()}`;
    return null;
  }).filter(Boolean);

  manifest.push({
    variant: v.id.toUpperCase(),
    file: v.outAss,
    mp4: v.outMp4,
    label: v.label,
    styleEncoding: v.encoding,
    rlePrefix: v.rle,
    dialogueTextLogical: SENTENCE,
    dialogueTextInFile: dialogueText,
    bidiMarkersInDialogue: codepoints,
    firstCodepoints: [...dialogueText].slice(0, 6).map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`)
  });
}

writeFileSync(join(__dir, 'manifest.json'), JSON.stringify({ sentence: SENTENCE, variants: manifest }, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, dir: __dir, variants: manifest.map((m) => m.variant) }, null, 2));
