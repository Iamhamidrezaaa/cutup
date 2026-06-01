/**
 * Temporary forensic A/B: production export.ass (Encoding=1) vs Encoding=0 only.
 * Does not modify api/video-render production code.
 *
 * Usage:
 *   node experiments/export-encoding-ab/run-encoding-ab.mjs
 *   node experiments/export-encoding-ab/run-encoding-ab.mjs --input /path/to/video.mp4
 *   INPUT_VIDEO=/path/to/video.mp4 node experiments/export-encoding-ab/run-encoding-ab.mjs
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { generateAssContent } from '../../api/video-render/ass-generator.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const W = 1080;
const H = 1920;

const SAMPLE_SEGMENTS = [
  {
    start: 0.59,
    end: 3.57,
    text: 'عذرخواهی می‌کنم، آقا. آیا واقعاً مثل',
    isFinal: true
  },
  {
    start: 3.58,
    end: 6.2,
    text: 'سنگین است مثل اینکه با آن مبارزه می‌کنی؟',
    isFinal: true
  },
  {
    start: 6.3,
    end: 9.0,
    text: 'آیا همه چیز خوب است؟ من سعی می‌کنم',
    isFinal: true
  }
];

function parseArgs() {
  const argv = process.argv.slice(2);
  let input = process.env.INPUT_VIDEO || null;
  let preset = process.env.EXPORT_PRESET || 'hormozi';
  let outDir = __dir;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i];
    else if (argv[i] === '--preset' && argv[i + 1]) preset = argv[++i];
    else if (argv[i] === '--outdir' && argv[i + 1]) outDir = resolve(argv[++i]);
  }
  return { input, preset, outDir };
}

/**
 * Change only the Style line Encoding field (last CSV column). Leaves Format/Dialogue untouched.
 * @param {string} raw
 * @param {0|1} encoding
 */
function cloneAssStyleEncodingOnly(raw, encoding) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  return lines
    .map((line) => {
      if (!line.startsWith('Style:')) return line;
      const body = line.slice(6).trim();
      const parts = body.split(',');
      if (parts.length < 23) {
        throw new Error(`Style line has ${parts.length} fields, expected 23: ${line}`);
      }
      const prev = parts[parts.length - 1];
      parts[parts.length - 1] = String(encoding);
      if (prev !== '1' && prev !== '0') {
        throw new Error(`Unexpected Encoding value "${prev}" in: ${line}`);
      }
      return `Style: ${parts.join(',')}`;
    })
    .join('\n');
}

function extractStyleLines(raw) {
  return String(raw)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.startsWith('Style:'));
}

function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

function burnAss({ outDir, assFile, mp4File, inputVideo, durationSec }) {
  const assName = assFile;
  const vf = `scale=${W}:${H},ass=${assName}`;
  const outPath = join(outDir, mp4File);

  const args = ['-hide_banner', '-y'];
  if (inputVideo) {
    args.push('-i', resolve(inputVideo));
  } else {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `color=c=#2a2a2a:s=${W}x${H}:d=${durationSec}:r=30`
    );
  }
  args.push(
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-t',
    String(durationSec),
    '-an',
    outPath
  );

  const proc = spawnSync('ffmpeg', args, {
    cwd: outDir,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });

  return {
    ok: proc.status === 0,
    vf,
    mp4: outPath,
    command: `ffmpeg ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`,
    cwd: outDir,
    stderr: proc.status !== 0 ? (proc.stderr || proc.stdout || '').slice(-1500) : null
  };
}

function main() {
  const { input, preset, outDir } = parseArgs();
  mkdirSync(outDir, { recursive: true });

  const assResult = generateAssContent(SAMPLE_SEGMENTS, preset, {
    captionMode: 'accurate',
    playResX: W,
    playResY: H,
    durationSec: 12
  });

  const exportAssPath = join(outDir, 'export.ass');
  const exportEnc0Path = join(outDir, 'export-encoding0.ass');
  const content1 = String(assResult.content || '').replace(/\r\n/g, '\n');
  writeFileSync(exportAssPath, content1, 'utf8');

  const content0 = cloneAssStyleEncodingOnly(content1, 0);
  writeFileSync(exportEnc0Path, content0, 'utf8');

  const styles1 = extractStyleLines(content1);
  const styles0 = extractStyleLines(content0);
  const encodingDiff = styles1.map((s, i) => ({
    style: s.split(',')[0],
    encoding1: s.split(',').pop(),
    encoding0: styles0[i]?.split(',').pop()
  }));

  const manifest = {
    at: new Date().toISOString(),
    purpose: 'encoding_ab_forensic',
    preset,
    inputVideo: input ? resolve(input) : null,
    outDir: resolve(outDir),
    files: {
      exportAss: exportAssPath,
      exportEncoding0Ass: exportEnc0Path,
      testEncoding1Mp4: join(outDir, 'test-encoding1.mp4'),
      testEncoding0Mp4: join(outDir, 'test-encoding0.mp4')
    },
    styleEncodingOnlyChange: encodingDiff,
    dialogueSample: content1
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'))
      .slice(0, 3),
    filterTemplate: `scale=${W}:${H},ass=<basename.ass>`
  };

  let burn1 = null;
  let burn0 = null;

  if (ffmpegAvailable()) {
    const durationSec = input ? 12 : 10;
    burn1 = burnAss({
      outDir,
      assFile: 'export.ass',
      mp4File: 'test-encoding1.mp4',
      inputVideo: input,
      durationSec
    });
    burn0 = burnAss({
      outDir,
      assFile: 'export-encoding0.ass',
      mp4File: 'test-encoding0.mp4',
      inputVideo: input,
      durationSec
    });
    manifest.burn = { encoding1: burn1, encoding0: burn0 };
    manifest.ok = burn1.ok && burn0.ok;
  } else {
    manifest.ok = false;
    manifest.burnSkipped = 'ffmpeg not on PATH — ASS files written; run burn on Linux server';
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(manifest.ok ? 0 : manifest.burnSkipped ? 0 : 1);
}

main();
