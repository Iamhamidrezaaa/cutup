/**
 * Caption rendering forensic trace — first N cues only.
 * Enable: CAPTION_FORENSIC=1 (default on)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export const CAPTION_FORENSIC_MAX = 10;

export function isCaptionForensicEnabled() {
  return String(process.env.CAPTION_FORENSIC ?? '1') !== '0';
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundSec(v) {
  const n = num(v);
  return n == null ? null : Number(n.toFixed(3));
}

function linesEqual(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  return aa.every((line, i) => String(line).trim() === String(bb[i]).trim());
}

/**
 * @param {object} opts
 * @param {string} [opts.traceId]
 * @param {string} [opts.stylePreset]
 * @param {{ start, end, text }[]} [opts.transcriptSegments]
 * @param {{ start, end, text }[]} [opts.translatedSegments]
 * @param {{ start, end, text }[]} [opts.exportInputSegments]
 * @param {{ start, end, text, sourceStart?, sourceEnd? }[]} [opts.canonicalCues]
 * @param {{ assStart, assEnd, text }[]} [opts.assDialogues]
 * @param {string[][]} [opts.exportSegmentedLines]
 * @param {object[]} [opts.previewRows]
 * @param {string} [opts.jobDir]
 */
export function buildCaptionForensicRows(opts = {}) {
  const transcript = Array.isArray(opts.transcriptSegments) ? opts.transcriptSegments : [];
  const translated = Array.isArray(opts.translatedSegments) ? opts.translatedSegments : [];
  const exportInput = Array.isArray(opts.exportInputSegments)
    ? opts.exportInputSegments
    : translated.length
      ? translated
      : transcript;
  const canonical = Array.isArray(opts.canonicalCues) ? opts.canonicalCues : [];
  const ass = Array.isArray(opts.assDialogues) ? opts.assDialogues : [];
  const exportLines = Array.isArray(opts.exportSegmentedLines) ? opts.exportSegmentedLines : [];
  const previewByIndex = new Map(
    (Array.isArray(opts.previewRows) ? opts.previewRows : []).map((r) => [Number(r.cueIndex), r])
  );
  const stylePreset = opts.stylePreset || 'hormozi';
  const max = Math.min(
    CAPTION_FORENSIC_MAX,
    Math.max(exportInput.length, transcript.length, canonical.length, ass.length, 0)
  );

  const rows = [];
  for (let cueIndex = 0; cueIndex < max; cueIndex++) {
    const tr = transcript[cueIndex];
    const trCue = translated[cueIndex];
    const inCue = exportInput[cueIndex];
    const canon = canonical[cueIndex];
    const assRow = ass[cueIndex];
    const preview = previewByIndex.get(cueIndex);

    const previewLines = preview?.segmentedLines || preview?.segmentedLinesPreview || [];
    const exportSegLines = exportLines[cueIndex] || (canon?.text ? [String(canon.text)] : []);

    rows.push({
      cueIndex,
      originalStart: roundSec(tr?.start ?? inCue?.start),
      originalEnd: roundSec(tr?.end ?? inCue?.end),
      translatedStart: roundSec(trCue?.start ?? inCue?.start),
      translatedEnd: roundSec(trCue?.end ?? inCue?.end),
      previewStart: roundSec(preview?.previewStart ?? inCue?.start ?? tr?.start),
      previewEnd: roundSec(preview?.previewEnd ?? inCue?.end ?? tr?.end),
      exportStart: roundSec(assRow?.assStart ?? canon?.sourceStart ?? canon?.start),
      exportEnd: roundSec(assRow?.assEnd ?? canon?.sourceEnd ?? canon?.end),
      text: String(inCue?.text ?? canon?.text ?? trCue?.text ?? tr?.text ?? '').slice(0, 200),
      transcriptText: tr?.text ? String(tr.text).slice(0, 120) : undefined,
      segmentedLines: {
        preview: previewLines,
        export: exportSegLines
      },
      stylePreset: preview?.stylePreset || stylePreset,
      previewRenderer: preview?.previewRenderer || 'CutupStyleRenderer',
      exportRenderer: 'ass-generator+ffmpeg-burn',
      canonicalCueIndex: cueIndex,
      exportInputCount: exportInput.length,
      canonicalCueCount: canonical.length,
      segmentationMatch: linesEqual(previewLines, exportSegLines),
      previewExportStartDeltaMs:
        preview?.previewStart != null && (assRow?.assStart ?? canon?.start) != null
          ? Math.round(((assRow?.assStart ?? canon?.start) - preview.previewStart) * 1000)
          : inCue?.start != null && (assRow?.assStart ?? canon?.start) != null
            ? Math.round(((assRow?.assStart ?? canon?.start) - inCue.start) * 1000)
            : null
    });
  }
  return rows;
}

/**
 * @param {ReturnType<typeof buildCaptionForensicRows>} rows
 */
export function buildCaptionForensicRootCause(rows, opts = {}) {
  const first = rows[0];
  const firstOriginalStart = num(first?.originalStart, 0);
  const firstPreviewStart = num(first?.previewStart, firstOriginalStart);
  const firstExportStart = num(first?.exportStart, firstPreviewStart);

  const segmentationBreaks = rows.filter(
    (r) =>
      r.segmentedLines?.preview?.length &&
      r.segmentedLines?.export?.length &&
      !r.segmentationMatch
  );

  const previewExportDeltas = rows
    .map((r) => r.previewExportStartDeltaMs)
    .filter((v) => v != null);

  const exportInputCount = num(rows[0]?.exportInputCount, 0);
  const canonicalCount = num(rows[0]?.canonicalCueCount, 0);
  const cuesCollapsed = exportInputCount > 0 && canonicalCount > 0 && canonicalCount < exportInputCount;

  return {
    traceId: opts.traceId || null,
    cueCountLogged: rows.length,
    regressionFindings: {
      firstSubtitleLate: {
        originalStartSec: firstOriginalStart,
        previewStartSec: firstPreviewStart,
        exportStartSec: firstExportStart,
        lateByPreviewMs: Math.round((firstPreviewStart - firstOriginalStart) * 1000),
        lateByExportMs: Math.round((firstExportStart - firstOriginalStart) * 1000),
        likelyCause:
          firstOriginalStart >= 1.5
            ? 'whisper_first_segment_late (transcript start > 0, not export burn delay)'
            : firstExportStart - firstPreviewStart > 0.15
              ? 'export_stabilizeBurnCueTiming_or_rolling_merge'
              : 'timing_aligned_at_source'
      },
      previewExportStyleDivergence: {
        previewRenderer: 'CutupStyleRenderer (DOM/CSS, chunkWords layout)',
        exportRenderer: 'ass-generator (layoutLinesLegacyStack, ASS inline tags, ffmpeg burn)',
        presetPreviewId: opts.stylePreset || 'hormozi',
        presetExportId: opts.exportPresetId || opts.stylePreset || 'alexHormozi',
        avgPreviewExportStartDeltaMs:
          previewExportDeltas.length > 0
            ? Math.round(previewExportDeltas.reduce((a, b) => a + b, 0) / previewExportDeltas.length)
            : 0,
        likelyCause:
          'Different layout engines (client chunkWords vs server legacyStack), font/CSS vs ASS typography, RTL/font overrides in preview only'
      },
      segmentationBreaks: {
        count: segmentationBreaks.length,
        cueIndices: segmentationBreaks.map((r) => r.cueIndex),
        likelyCause:
          'Preview uses website/subtitle-styles/utils/text-layout.js chunkWords; export uses api/video-render/text-layout.js layoutLinesLegacyStack (semantic production off by default)'
      },
      hormoziKaraokeAppearance: {
        previewPath: 'CutupStyleRenderer spokenWord CSS OR FakePlayerAnimator mid-word highlight cycle',
        exportPath: 'ass-generator spokenWord inline {\\c\\b1} tags (static per cue, not \\k karaoke)',
        likelyCause:
          'FakePlayerAnimator cycles cues every 3.8s with mid-sentence highlight (karaoke-like); export uses one spoken word per full cue duration'
      }
    },
    pipelineNotes: {
      cuesCollapsedOnExport: cuesCollapsed,
      exportInputCues: exportInputCount,
      canonicalCuesAfterMerge: canonicalCount,
      burnLeadDelaySec: num(opts.burnLeadDelaySec, 0.09),
      note: 'Export applies mergeRollingCaptionChains + coalesceBurnPhrases + stabilizeBurnCueTiming; preview uses raw segment times'
    }
  };
}

export function logCaptionForensics(opts = {}) {
  if (!isCaptionForensicEnabled()) return null;

  const rows = buildCaptionForensicRows(opts);
  for (const row of rows) {
    console.log('[caption-forensics]', JSON.stringify(row));
  }

  const summary = buildCaptionForensicRootCause(rows, opts);
  console.log('[caption-forensics-summary]', JSON.stringify(summary));

  const payload = { rows, summary };
  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(join(opts.jobDir, 'caption-forensics.json'), JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn('[caption-forensics] write failed:', err?.message);
    }
  }
  return payload;
}
