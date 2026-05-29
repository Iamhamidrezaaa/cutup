/**
 * Burn all 4 ASS variants with identical FFmpeg ass= filter (isolated experiment).
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

const VARIANTS = [
  { ass: 'test-a.ass', mp4: 'test-a.mp4', label: 'A: Encoding=1' },
  { ass: 'test-b.ass', mp4: 'test-b.mp4', label: 'B: Encoding=0' },
  { ass: 'test-c.ass', mp4: 'test-c.mp4', label: 'C: Encoding=1 + RLE' },
  { ass: 'test-d.ass', mp4: 'test-d.mp4', label: 'D: Encoding=0 + RLE' }
];

const DURATION_SEC = 4;
const W = 1080;
const H = 1920;

function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

function burnVariant({ ass, mp4, label }) {
  const assPath = join(__dir, ass);
  const outPath = join(__dir, mp4);
  if (!existsSync(assPath)) {
    return { ass, mp4, label, ok: false, error: `Missing ${ass}` };
  }

  const assName = ass;
  const vf = `scale=${W}:${H},ass=${assName}`;
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
    outPath
  ];

  const proc = spawnSync('ffmpeg', args, {
    cwd: __dir,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });

  if (proc.status !== 0) {
    return {
      ass,
      mp4,
      label,
      ok: false,
      vf,
      error: (proc.stderr || proc.stdout || `exit ${proc.status}`).slice(-1200)
    };
  }

  return { ass, mp4, label, ok: true, vf, output: outPath };
}

if (!ffmpegAvailable()) {
  const msg = {
    ok: false,
    error: 'ffmpeg not found on PATH',
    hint: 'Run on render server: node experiments/ass-encoding-rle/run-burn-tests.mjs',
    generatedAss: VARIANTS.map((v) => v.ass)
  };
  writeFileSync(join(__dir, 'results.json'), JSON.stringify(msg, null, 2), 'utf8');
  console.log(JSON.stringify(msg, null, 2));
  process.exit(1);
}

const results = VARIANTS.map(burnVariant);
const allOk = results.every((r) => r.ok);

const report = {
  ok: allOk,
  sentence: 'من آماده هستم',
  filterTemplate: `scale=${W}:${H},ass=<basename.ass>`,
  durationSec: DURATION_SEC,
  cwd: __dir,
  results,
  visualCheckRequired:
    'Open test-a.mp4 … test-d.mp4 and compare word order + glyph shaping for: من آماده هستم',
  whichIsCorrect: 'AGENT_CANNOT_VERIFY_VIDEO — human must label winner in RESULTS.md'
};

writeFileSync(join(__dir, 'results.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
process.exit(allOk ? 0 : 1);
