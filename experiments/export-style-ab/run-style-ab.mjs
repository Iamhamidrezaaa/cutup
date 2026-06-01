/**
 * Forensic: Hormozi style params vs test-fa simple style (Dialogue unchanged).
 *
 *   node experiments/export-style-ab/run-style-ab.mjs
 *   node experiments/export-style-ab/run-style-ab.mjs --input /tmp/cutup_render_XXX/export.ass
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const W = 1080;
const H = 1920;

/** Exact field tail from working test-fa.ass / test-a.ass (RTL_Test row). Fontname preserved. */
const TEST_FA_STYLE_FIELDS =
  'Vazirmatn,72,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,2,0,2,140,140,292,1';

const STYLE_FORMAT_LINE =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

function parseArgs() {
  const argv = process.argv.slice(2);
  let input = join(__dir, '../export-encoding-ab/export.ass');
  let outDir = __dir;
  let durationSec = 12;
  let inputVideo = process.env.INPUT_VIDEO || null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = resolve(argv[++i]);
    else if (argv[i] === '--outdir' && argv[i + 1]) outDir = resolve(argv[++i]);
    else if (argv[i] === '--duration' && argv[i + 1]) durationSec = Number(argv[++i]) || 12;
    else if (argv[i] === '--input-video' && argv[i + 1]) inputVideo = resolve(argv[++i]);
  }
  return { input, outDir, durationSec, inputVideo };
}

function parseAssSections(raw) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  const styleNames = [];
  const eventsLines = [];
  const headerLines = [];
  let i = 0;
  let phase = 'header';

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '[V4+ Styles]') {
      phase = 'styles';
      i++;
      break;
    }
    if (phase === 'header') headerLines.push(line);
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '[Events]') {
      phase = 'events';
      eventsLines.push(line);
      i++;
      break;
    }
    if (line.startsWith('Style:')) {
      const name = line.slice(6).trim().split(',')[0];
      styleNames.push(name);
    }
    if (line.startsWith('Format:') && phase === 'styles') {
      /* skip original format — rewritten */
    }
  }

  for (; i < lines.length; i++) {
    eventsLines.push(lines[i]);
  }

  return { headerLines, styleNames, eventsLines };
}

function buildSimpleStyles(styleNames) {
  const names =
    styleNames.length > 0 ? styleNames : ['Default', 'Emphasis', 'RTL_Default'];
  const unique = [...new Set(names)];
  return [
    '[V4+ Styles]',
    STYLE_FORMAT_LINE,
    ...unique.map((name) => `Style: ${name},${TEST_FA_STYLE_FIELDS}`)
  ];
}

function assembleAss(headerLines, styleBlock, eventsLines) {
  const parts = [...headerLines];
  if (parts.length && parts[parts.length - 1] !== '') parts.push('');
  parts.push(...styleBlock);
  parts.push('');
  parts.push(...eventsLines);
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return `${parts.join('\n')}\n`;
}

function ffmpegAvailable() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true }).status === 0;
}

function burn({ outDir, assFile, mp4File, inputVideo, durationSec }) {
  const vf = `scale=${W}:${H},ass=${assFile}`;
  const outPath = join(outDir, mp4File);
  const args = ['-hide_banner', '-y'];
  if (inputVideo && existsSync(inputVideo)) {
    args.push('-i', inputVideo, '-t', String(durationSec));
  } else {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `color=c=#2a2a2a:s=${W}x${H}:d=${durationSec}:r=30`
    );
  }
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', outPath);

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
    error: proc.status !== 0 ? (proc.stderr || '').slice(-1500) : null
  };
}

function main() {
  const { input, outDir, durationSec, inputVideo } = parseArgs();
  mkdirSync(outDir, { recursive: true });

  if (!existsSync(input)) {
    console.error(JSON.stringify({ ok: false, error: `Missing input ASS: ${input}` }));
    process.exit(1);
  }

  const originalRaw = readFileSync(input, 'utf8');
  const { headerLines, styleNames, eventsLines } = parseAssSections(originalRaw);

  const originalPath = join(outDir, 'export-original.ass');
  const simplePath = join(outDir, 'export-style-simple.ass');
  copyFileSync(input, originalPath);

  const simpleStyleBlock = buildSimpleStyles(styleNames);
  const simpleContent = assembleAss(headerLines, simpleStyleBlock, eventsLines);
  writeFileSync(simplePath, simpleContent, 'utf8');

  const originalStyles = originalRaw
    .split('\n')
    .filter((l) => l.startsWith('Style:'));
  const simpleStyles = simpleContent
    .split('\n')
    .filter((l) => l.startsWith('Style:'));

  console.log('========== export-original.ass (styles) ==========');
  originalStyles.forEach((l) => console.log(l));
  console.log('========== export-style-simple.ass (styles) ==========');
  simpleStyles.forEach((l) => console.log(l));
  console.log('========== Dialogue count (unchanged) ==========');
  const dialogues = eventsLines.filter((l) => l.startsWith('Dialogue:'));
  console.log(dialogues.length, 'lines');
  dialogues.forEach((l) => console.log(l));

  const manifest = {
    at: new Date().toISOString(),
    purpose: 'hormozi_style_vs_test_fa_style',
    inputAss: resolve(input),
    outDir: resolve(outDir),
    files: {
      exportOriginalAss: originalPath,
      exportStyleSimpleAss: simplePath,
      exportOriginalMp4: join(outDir, 'export-original.mp4'),
      exportStyleSimpleMp4: join(outDir, 'export-style-simple.mp4')
    },
    testFaStyleFields: TEST_FA_STYLE_FIELDS,
    styleNamesReplaced: styleNames,
    originalStyles,
    simpleStyles,
    dialogueLineCount: dialogues.length,
    dialoguesUnchanged: true,
    ffmpegFilter: `scale=${W}:${H},ass=<basename.ass>`
  };

  if (ffmpegAvailable()) {
    manifest.burnOriginal = burn({
      outDir,
      assFile: 'export-original.ass',
      mp4File: 'export-original.mp4',
      inputVideo,
      durationSec
    });
    manifest.burnSimple = burn({
      outDir,
      assFile: 'export-style-simple.ass',
      mp4File: 'export-style-simple.mp4',
      inputVideo,
      durationSec
    });
    manifest.ok = manifest.burnOriginal.ok && manifest.burnSimple.ok;
  } else {
    manifest.ok = false;
    manifest.burnSkipped = 'ffmpeg not on PATH — run on Linux server';
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('========== manifest ==========');
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(manifest.burnSkipped ? 0 : manifest.ok ? 0 : 1);
}

main();
