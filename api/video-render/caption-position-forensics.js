/**
 * Caption vertical position forensic (read-only). Layout/timing scope only.
 * Enable: CAPTION_POSITION_FORENSIC=1
 * Writes: {jobDir}/CAPTION-POSITION-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { isRtlText } from './rtl-text.js';
import {
  buildPhraseBurnSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows
} from './subtitle-pipeline.js';
import {
  resolveRenderLayout,
  resolveCueLineLayout,
  buildAssBottomAnchorTag
} from './layout-engine.js';
import { buildCueLines } from './text-layout.js';

const MAX_CUES = 20;

export function isCaptionPositionForensicEnabled() {
  return String(process.env.CAPTION_POSITION_FORENSIC ?? '1') !== '0';
}

function stripAssTags(text) {
  return String(text || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .trim();
}

function parsePosTag(text) {
  const m = String(text || '').match(/\\pos\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return { posX: null, posY: null };
  return { posX: Number(m[1]), posY: Number(m[2]) };
}

function parseAssStyleRows(content) {
  const styles = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('Style:')) continue;
    const parts = line.split(',');
    const name = parts[0].replace(/^Style:\s*/, '').trim();
    if (!name) continue;
    styles[name] = {
      alignment: Number(parts[18]) || null,
      marginL: Number(parts[15]) || null,
      marginR: Number(parts[16]) || null,
      marginV: Number(parts[17]) || null
    };
  }
  return styles;
}

function parseDialogueRows(content, limit = MAX_CUES) {
  const rows = [];
  for (const line of String(content || '').split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.split(',');
    if (parts.length < 10) continue;
    const styleName = parts[3]?.trim() || '';
    const marginL = Number(parts[5]);
    const marginR = Number(parts[6]);
    const marginV = Number(parts[7]);
    const text = parts.slice(9).join(',').trim();
    const plain = stripAssTags(text);
    const assLines = plain.split(/\n/).filter(Boolean);
    const pos = parsePosTag(text);
    rows.push({
      styleName,
      marginL: Number.isFinite(marginL) ? marginL : null,
      marginR: Number.isFinite(marginR) ? marginR : null,
      marginV: Number.isFinite(marginV) ? marginV : null,
      dialogueText: text.slice(0, 500),
      plainText: plain.slice(0, 300),
      lineCount: Math.max(1, assLines.length),
      posX: pos.posX,
      posY: pos.posY,
      hasInlinePos: pos.posX != null,
      hasAn2: /\\an2/i.test(text)
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * @param {object} opts segments, assResult, presetId, captionMode, playResX, playResY, positionMode, durationSec
 */
export function buildCaptionPositionForensicsReport(opts = {}) {
  const presetId = resolvePresetIdOrThrow(opts.presetId || 'mrBeast');
  const preset = getStylePreset(presetId);
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const playResX = Number(opts.playResX || preset.playResX || 1080);
  const playResY = Number(opts.playResY || preset.playResY || 1920);
  const segments = Array.isArray(opts.segments) ? opts.segments : [];
  const assContent = String(opts.assResult?.content || opts.assContent || '');
  const assDialogues = opts.assResult?.timingAudit?.assDialogues || [];

  const phraseCues = buildPhraseBurnSubtitles(segments);
  const visualCues = buildVisualCueView(phraseCues, captionMode);
  const visibleCues =
    captionMode === 'accurate'
      ? visualCues
      : applyVisualReadabilityWindows(visualCues, {
          minCueDurationSec: Number(opts.minCueDurationSec ?? 0.74),
          minGapSec: 0.035,
          maxTailExtensionSec: 0.48,
          maxLeadExtensionSec: 0.16,
          videoDurationSec: Number(opts.durationSec ?? 0)
        });

  const layout = resolveRenderLayout(
    {
      playResX,
      playResY,
      durationSec: opts.durationSec || 0,
      positionMode: opts.positionMode || preset.positionMode || 'adaptive'
    },
    visibleCues,
    preset
  );

  const expectedAnchorY = Math.round(playResY - layout.marginV);
  const expectedPosTag = buildAssBottomAnchorTag(playResX, playResY, layout.marginV);
  const expectedPos = parsePosTag(expectedPosTag);
  const styleRows = parseAssStyleRows(assContent);
  const parsedDialogues = parseDialogueRows(assContent, MAX_CUES);

  const cues = [];
  for (let i = 0; i < Math.min(MAX_CUES, visibleCues.length); i++) {
    const cue = visibleCues[i] || {};
    const assRow = parsedDialogues[i] || {};
    const audit = assDialogues[i] || {};
    const cueText = String(cue.text || audit.text || '');
    const cueRtl = isRtlText(cueText);
    const cueLineLayout = resolveCueLineLayout(layout.layout, cueText);
    const lines = buildCueLines(cue, cueLineLayout, layout.useUppercase && !cueRtl);
    const styleName = assRow.styleName || (cueRtl ? `RTL_${presetId}` : 'Default');
    const styleDef = styleRows[styleName] || {};

    cues.push({
      cueIndex: i,
      alignment: styleDef.alignment ?? layout.alignment ?? 2,
      marginV: assRow.marginV,
      marginL: assRow.marginL,
      marginR: assRow.marginR,
      styleName,
      dialogueText: assRow.dialogueText || '',
      lineCount: assRow.lineCount || lines.length,
      buildCueLinesCount: lines.length,
      cueRtl,
      dialogueMarginVField: assRow.marginV,
      styleRowMarginV: styleDef.marginV,
      globalLayoutMarginV: layout.marginV,
      placementMarginV: layout.placement?.marginV ?? null,
      placementSafeZone: layout.placement?.safeZone ?? null,
      posX: assRow.posX,
      posY: assRow.posY,
      expectedPosY: expectedPos.posY,
      posYDeltaPx: assRow.posY != null ? assRow.posY - expectedAnchorY : null,
      hasInlinePos: assRow.hasInlinePos,
      hasAn2: assRow.hasAn2,
      inlinePosPrefix: assRow.hasInlinePos ? String(assRow.dialogueText || '').slice(0, 80) : null
    });
  }

  const posYValues = cues.map((c) => c.posY).filter((v) => v != null);
  const marginVValues = cues.map((c) => c.dialogueMarginVField).filter((v) => v != null);
  const lineCounts = cues.map((c) => c.lineCount);

  const uniquePosY = [...new Set(posYValues)];
  const uniqueMarginV = [...new Set(marginVValues)];
  const uniqueLineCounts = [...new Set(lineCounts)];

  let firstDynamic = null;
  if (uniquePosY.length > 1) {
    firstDynamic = {
      type: 'inline_pos_y_varies',
      function: 'ass-generator.js buildAssBottomAnchorTag / Dialogue assembly',
      evidence: { uniquePosY, sample: cues.find((c) => c.posY !== cues[0]?.posY) }
    };
  } else if (uniqueMarginV.length > 1) {
    firstDynamic = {
      type: 'dialogue_marginV_field_varies',
      function: 'generateAssContent visibleCues.map dialogueMarginV',
      evidence: { uniqueMarginV }
    };
  } else if (uniqueLineCounts.length > 1 && uniquePosY.length <= 1) {
    firstDynamic = {
      type: 'line_count_varies_fixed_anchor',
      function: 'buildCueLines → linesToAssText (\\N count)',
      note:
        'MarginV and \\pos(x,y) are constant per cue, but lineCount changes. With {\\an2\\pos} bottom-center anchor, libass grows the block upward as lines increase — perceived vertical drift.',
      evidence: { uniqueLineCounts, fixedPosY: uniquePosY[0] ?? expectedAnchorY }
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    playResX,
    playResY,
    presetId,
    captionMode,
    globalLayout: {
      alignment: layout.alignment,
      marginV: layout.marginV,
      marginL: layout.marginL,
      marginR: layout.marginR,
      placementMarginV: layout.placement?.marginV ?? null,
      placementNote:
        'resolveSubtitlePlacement computes placement.marginV but generateAssContent uses resolveBurnBottomMarginV (layout.marginV) for LTR \\pos — placement margin is not written to Dialogue fields.',
      expectedBottomAnchorY: expectedAnchorY,
      expectedPosTag,
      yAnchorRatio: Number((1 - layout.marginV / playResY).toFixed(4)),
      resolveBurnBottomMarginV: 'layout-engine.js resolveBurnBottomMarginV',
      buildAssBottomAnchorTag: 'layout-engine.js buildAssBottomAnchorTag',
      rtlDialogueMarginV: 0,
      ltrDialogueMarginV: layout.marginV
    },
    first20Cues: cues,
    positionVariability: {
      uniquePosYCount: uniquePosY.length,
      uniqueDialogueMarginVCount: uniqueMarginV.length,
      uniqueLineCountValues: uniqueLineCounts,
      posYValues: uniquePosY,
      marginVValues: uniqueMarginV,
      lineCountValues: uniqueLineCounts
    },
    firstCorruption: firstDynamic,
    traceChain: [
      'resolveRenderLayout → layout.marginV (fixed per export)',
      'resolveCueLineLayout → per-cue line layout (RTL forces single line)',
      'buildCueLines → line count',
      'LTR: buildAssBottomAnchorTag in Dialogue text (\\an2\\pos)',
      'RTL: dialogue MarginV=0, style RTL_* row',
      'ASS Dialogue fields: MarginL, MarginR, MarginV + inline tags'
    ],
    rootCauseAttribution: firstDynamic || {
      note: 'No per-cue MarginV/posY variance in first 20 dialogues; if drift still visible, compare preview CSS anchor vs export \\pos anchor.'
    }
  };
}

export function logCaptionPositionForensics(opts = {}) {
  if (!isCaptionPositionForensicEnabled()) return null;
  if (!opts.segments?.length && !opts.assResult?.content) return null;

  const report = buildCaptionPositionForensicsReport(opts);
  console.log(
    '[caption-position-forensics-summary]',
    JSON.stringify(report.firstCorruption || report.positionVariability)
  );

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'CAPTION-POSITION-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[caption-position-forensics] write failed:', err?.message);
    }
  }

  return report;
}
