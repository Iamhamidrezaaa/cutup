/**
 * Temporary pre-burn forensic: ASS on disk vs fontconfig (read-only).
 * Writes jobDir/rtl-forensics.json — does not modify ASS, FFmpeg args, or styles.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

const BIDI_CONTROL_CODEPOINTS = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x200e, 0x200f,
  0x2066, 0x2067, 0x2068, 0x2069
]);

const BIDI_CONTROL_NAMES = {
  0x202a: 'U+202A',
  0x202b: 'U+202B',
  0x202c: 'U+202C',
  0x202d: 'U+202D',
  0x202e: 'U+202E',
  0x200e: 'U+200E',
  0x200f: 'U+200F',
  0x2066: 'U+2066',
  0x2067: 'U+2067',
  0x2068: 'U+2068',
  0x2069: 'U+2069'
};

function extractDialogueText(line) {
  const m = String(line).match(
    /^Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/
  );
  return m ? m[10] : '';
}

function collectNonAsciiCodepoints(text) {
  const out = [];
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0x7f) {
      out.push({
        char: ch,
        codepoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
      });
    }
  }
  return out;
}

function scanBidiControls(text) {
  const found = [];
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (BIDI_CONTROL_CODEPOINTS.has(cp)) {
      const name = BIDI_CONTROL_NAMES[cp] || `U+${cp.toString(16).toUpperCase()}`;
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
}

function parseAssSections(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const styleLines = [];
  const dialogueLines = [];
  let inStyles = false;

  for (const line of lines) {
    if (line.trim() === '[V4+ Styles]') {
      inStyles = true;
      continue;
    }
    if (inStyles && line.trim().startsWith('[') && line.trim() !== '[V4+ Styles]') {
      inStyles = false;
    }
    if (inStyles && (line.startsWith('Format:') || line.startsWith('Style:'))) {
      styleLines.push(line);
    }
    if (line.startsWith('Dialogue:')) {
      dialogueLines.push(line);
    }
  }

  return { styleLines, dialogueLines };
}

async function runFcMatch(family) {
  const cmd = `fc-match ${family.includes(' ') ? `"${family}"` : family}`;
  try {
    const { stdout, stderr } = await execFileAsync('fc-match', [family], {
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 256 * 1024
    });
    return {
      command: cmd,
      ok: true,
      stdout: String(stdout || '').trim(),
      stderr: String(stderr || '').trim() || null
    };
  } catch (err) {
    return {
      command: cmd,
      ok: false,
      error: err?.message || String(err),
      stdout: err?.stdout ? String(err.stdout).trim() : null,
      stderr: err?.stderr ? String(err.stderr).trim() : null
    };
  }
}

async function runFcListVazir() {
  const command = 'fc-list | grep -i vazir';
  try {
    const { stdout } = await execFileAsync('fc-list', [], {
      encoding: 'utf8',
      timeout: 12000,
      maxBuffer: 2 * 1024 * 1024
    });
    const matched = String(stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /vazir/i.test(l));
    return {
      command,
      ok: true,
      lineCount: matched.length,
      lines: matched.slice(0, 50)
    };
  } catch (err) {
    return {
      command,
      ok: false,
      error: err?.message || String(err)
    };
  }
}

/**
 * @param {{
 *   burnAssPath: string,
 *   jobDir: string,
 *   generatorAssPath?: string|null,
 *   ffmpegCommandExact: string,
 *   ffmpegCwd: string
 * }} opts
 */
export async function runRtlBurnForensics(opts) {
  const burnAssAbsolute = resolve(opts.burnAssPath);
  const jobDir = opts.jobDir ? resolve(opts.jobDir) : null;
  const report = {
    at: new Date().toISOString(),
    purpose: 'pre_ffmpeg_burn_read_only',
    burnAssPath: burnAssAbsolute,
    generatorAssPath: opts.generatorAssPath ? resolve(opts.generatorAssPath) : null,
    ffmpegCwd: opts.ffmpegCwd ? resolve(opts.ffmpegCwd) : null,
    ffmpegCommandExact: opts.ffmpegCommandExact || null,
    assFileExists: existsSync(burnAssAbsolute),
    assFileSizeBytes: null,
    styleLines: [],
    first10Dialogues: [],
    bidiControlsInFirst10Dialogues: {},
    fcMatch: {},
    fcListVazir: null,
    verdictHint: null
  };

  if (!report.assFileExists) {
    report.verdictHint = 'ASS_FILE_MISSING_AT_BURN';
    if (jobDir) {
      try {
        mkdirSync(jobDir, { recursive: true });
        writeFileSync(join(jobDir, 'rtl-forensics.json'), JSON.stringify(report, null, 2), 'utf8');
      } catch {
        /* noop */
      }
    }
    console.log('[rtl-burn-forensics]', report);
    return report;
  }

  const raw = readFileSync(burnAssAbsolute, 'utf8');
  report.assFileSizeBytes = Buffer.byteLength(raw, 'utf8');

  const { styleLines, dialogueLines } = parseAssSections(raw);
  report.styleLines = styleLines;

  const first10 = dialogueLines.slice(0, 10);
  const allBidiFound = new Set();

  report.first10Dialogues = first10.map((line, index) => {
    const text = extractDialogueText(line);
    const nonAscii = collectNonAsciiCodepoints(text);
    const bidiInLine = scanBidiControls(text);
    bidiInLine.forEach((b) => allBidiFound.add(b));
    return {
      index,
      lineExact: line,
      dialogueText: text,
      nonAsciiCodepoints: nonAscii,
      bidiControlsPresent: bidiInLine
    };
  });

  const checks = [
    'U+202A',
    'U+202B',
    'U+202C',
    'U+202D',
    'U+202E',
    'U+200E',
    'U+200F',
    'U+2066',
    'U+2067',
    'U+2068',
    'U+2069'
  ];
  for (const name of checks) {
    report.bidiControlsInFirst10Dialogues[name] = allBidiFound.has(name);
  }

  const [vazir, notoSans, notoNaskh, fcListVazir] = await Promise.all([
    runFcMatch('Vazirmatn'),
    runFcMatch('Noto Sans Arabic'),
    runFcMatch('Noto Naskh Arabic'),
    runFcListVazir()
  ]);

  report.fcMatch = {
    Vazirmatn: vazir,
    'Noto Sans Arabic': notoSans,
    'Noto Naskh Arabic': notoNaskh
  };
  report.fcListVazir = fcListVazir;

  const anyBidi = [...allBidiFound].length > 0;
  const vazirResolved = Boolean(vazir.ok && vazir.stdout && /vazirmatn/i.test(vazir.stdout));

  if (anyBidi) {
    report.verdictHint =
      'ASS_CONTAINS_BIDI_CONTROL_CHARS_BEFORE_BURN — corruption likely in ASS generator or upstream text';
  } else if (!vazirResolved && fcListVazir.ok && fcListVazir.lineCount === 0) {
    report.verdictHint =
      'ASS_TEXT_LOGICAL_NO_BIDI_MARKERS — Vazirmatn not in fontconfig; if MP4 corrupt, suspect libass/font shaping';
  } else {
    report.verdictHint =
      'ASS_TEXT_LOGICAL_NO_BIDI_MARKERS — if MP4 still corrupt, suspect libass BiDi/shaping not font name alone';
  }

  console.log('[rtl-burn-forensics] style-lines', report.styleLines);
  console.log('[rtl-burn-forensics] first-10-dialogues', {
    count: report.first10Dialogues.length,
    lines: report.first10Dialogues.map((d) => d.lineExact)
  });
  console.log('[rtl-burn-forensics] non-ascii-codepoints', {
    dialogues: report.first10Dialogues.map((d) => ({
      index: d.index,
      codepoints: d.nonAsciiCodepoints
    }))
  });
  console.log('[rtl-burn-forensics] bidi-controls', report.bidiControlsInFirst10Dialogues);
  console.log('[rtl-burn-forensics] fc-match', report.fcMatch);
  console.log('[rtl-burn-forensics] fc-list-vazir', report.fcListVazir);
  console.log('[rtl-burn-forensics] ffmpeg-command-exact', report.ffmpegCommandExact);
  console.log('[rtl-burn-forensics] verdict-hint', report.verdictHint);

  if (jobDir) {
    try {
      mkdirSync(jobDir, { recursive: true });
      const outPath = join(jobDir, 'rtl-forensics.json');
      writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
      report.rtlForensicsPath = resolve(outPath);
      console.log('[rtl-burn-forensics] saved', { path: report.rtlForensicsPath });
    } catch (err) {
      report.saveError = err?.message || String(err);
      console.warn('[rtl-burn-forensics] save failed', report.saveError);
    }
  }

  return report;
}
