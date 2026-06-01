/**
 * Forensic: does ASS \N alone break Persian RTL rendering?
 * Standalone — no production pipeline, Hormozi, or RTL_Default.
 *
 * Style matches successful server test-fa.ass (minimal Vazirmatn, Encoding=1).
 *
 *   node experiments/ass-newline-rtl-ab/run-newline-ab.mjs
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const W = 1080;
const H = 1920;
const DURATION_SEC = 4;

/** Same header/style as experiments/ass-encoding-rle test-a (known-good test-fa.ass shape). */
function buildAss(dialogueText) {
  return [
    '[Script Info]',
    'Title: Cutup ASS Newline RTL Forensic',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: RTL_Test,Vazirmatn,72,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,2,0,2,140,140,292,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.50,0:00:04.00,RTL_Test,,0,0,0,,${dialogueText}`,
    ''
  ].join('\n');
}

function ffmpegAvailable() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true }).status === 0;
}

function burn(assFile, mp4File) {
  const vf = `scale=${W}:${H},ass=${assFile}`;
  const args = [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=#1a1a1a:s=${W}x${H}:d=${DURATION_SEC}:r=30`,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-an',
    mp4File
  ];
  const proc = spawnSync('ffmpeg', args, {
    cwd: __dir,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    ok: proc.status === 0,
    vf,
    command: `cd ${__dir} && ffmpeg ${args.join(' ')}`,
    error: proc.status !== 0 ? (proc.stderr || '').slice(-1200) : null
  };
}

function main() {
  mkdirSync(__dir, { recursive: true });

  const singleText = 'سلام دنیا';
  const multiText = 'سلام دنیا\\Nخوبی؟';

  const assA = buildAss(singleText);
  const assB = buildAss(multiText);

  const pathA = join(__dir, 'test-singleline.ass');
  const pathB = join(__dir, 'test-multiline.ass');
  writeFileSync(pathA, assA, 'utf8');
  writeFileSync(pathB, assB, 'utf8');

  console.log('========== test-singleline.ass ==========');
  console.log(assA);
  console.log('========== test-multiline.ass ==========');
  console.log(assB);

  const manifest = {
    at: new Date().toISOString(),
    purpose: 'newline_rtl_ab',
    hypothesis: 'Does \\N alone corrupt Persian RTL when style matches test-fa.ass?',
    styleNote: 'RTL_Test + Vazirmatn + Encoding=1 (not Hormozi / RTL_Default / export.ass)',
    testA: {
      ass: 'test-singleline.ass',
      mp4: 'test-singleline.mp4',
      dialogueText: singleText
    },
    testB: {
      ass: 'test-multiline.ass',
      mp4: 'test-multiline.mp4',
      dialogueText: multiText,
      dialogueLogical: 'سلام دنیا + line break + خوبی؟'
    },
    ffmpegFilter: `scale=${W}:${H},ass=<basename.ass>`
  };

  if (ffmpegAvailable()) {
    manifest.burnA = burn('test-singleline.ass', 'test-singleline.mp4');
    manifest.burnB = burn('test-multiline.ass', 'test-multiline.mp4');
    manifest.ok = manifest.burnA.ok && manifest.burnB.ok;
  } else {
    manifest.ok = false;
    manifest.burnSkipped =
      'ffmpeg not on PATH — ASS written; run on Linux server: node experiments/ass-newline-rtl-ab/run-newline-ab.mjs';
  }

  writeFileSync(join(__dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('========== manifest ==========');
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(manifest.burnSkipped ? 0 : manifest.ok ? 0 : 1);
}

main();
