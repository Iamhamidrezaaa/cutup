/**
 * RTL Persian phrase word-order forensic (read-only text reconstruction trace).
 * Enable: RTL_PHRASE_ORDER_FORENSIC=1
 * Writes: {jobDir}/RTL-PHRASE-ORDER-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { isRtlText } from './rtl-text.js';
import { isDebugExportEnabled } from './export-debug.js';
import { buildPhraseBurnSubtitles } from './subtitle-pipeline.js';
import { buildCueLines } from './text-layout.js';
import { resolveCueLineLayout } from './layout-engine.js';
import { forensicTraceRtlPhraseText } from './ass-generator.js';

const MAX_CUES = 20;

export function isRtlPhraseOrderForensicEnabled() {
  return isDebugExportEnabled() && String(process.env.RTL_PHRASE_ORDER_FORENSIC ?? '1') !== '0';
}

function wordsList(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stripAssTags(text) {
  return String(text || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function orderChanged(before, after) {
  const a = wordsList(before);
  const b = wordsList(after);
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

function findTranslatedSourceForPhrase(phrase, segments) {
  const anchor = Number(phrase.firstWordStart ?? phrase.start);
  if (!Number.isFinite(anchor)) return null;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s) continue;
    if (anchor >= Number(s.start) - 0.15 && anchor <= Number(s.end) + 0.15) {
      return { segmentIndex: i, text: String(s.text || '') };
    }
  }
  return null;
}

/**
 * @param {object[]} exportSegments
 * @param {object} opts presetId, captionMode, assResult
 */
export function buildRtlPhraseOrderForensicsReport(exportSegments, opts = {}) {
  const presetId = resolvePresetIdOrThrow(opts.presetId || 'mrBeast');
  const preset = getStylePreset(presetId);
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const translatedSegments = opts.translatedSegments || exportSegments || [];
  const phraseCues = buildPhraseBurnSubtitles(exportSegments);
  const assDialogues = opts.assResult?.timingAudit?.assDialogues || [];

  const cues = [];
  let firstCorruption = null;

  for (let phraseIndex = 0; phraseIndex < Math.min(MAX_CUES, phraseCues.length); phraseIndex++) {
    const phrase = phraseCues[phraseIndex];
    const cueText = String(phrase.text || '');
    if (!isRtlText(cueText)) continue;

    const src = findTranslatedSourceForPhrase(phrase, translatedSegments);
    const originalTranslatedText = src?.text || opts.translatedTextByPhrase?.[phraseIndex] || '';

    const phraseWordsBeforeLayout = wordsList(cueText);
    const cueLineLayout = resolveCueLineLayout(preset.layout || {}, cueText);
    const lines = buildCueLines(phrase, cueLineLayout, false);
    const phraseWordsAfterLayout = wordsList(lines.join(' '));

    const trace = forensicTraceRtlPhraseText(phrase, preset, {
      captionMode,
      layout: preset.layout
    });

    const phraseTextBeforeRTL = cueText;
    const phraseTextAfterRTL = stripAssTags(trace.bodyResult?.text || '');
    const finalAssText = stripAssTags(assDialogues[phraseIndex]?.text || trace.finalText || '');

    const wordOrderChanged =
      orderChanged(originalTranslatedText, cueText) ||
      orderChanged(cueText, lines.join(' ')) ||
      orderChanged(lines.join(' '), phraseTextAfterRTL) ||
      orderChanged(phraseTextAfterRTL, finalAssText);

    let introducedAtFunction = null;
    let before = originalTranslatedText;
    let after = cueText;

    if (orderChanged(originalTranslatedText, cueText)) {
      introducedAtFunction = 'buildPhraseBurnSubtitles / composeRhythmBlocks (phrase text assembly)';
      before = originalTranslatedText;
      after = cueText;
    } else if (orderChanged(cueText, lines.join(' '))) {
      introducedAtFunction = 'buildCueLines / layoutLines';
      before = cueText;
      after = lines.join(' ');
    } else if (orderChanged(lines.join(' '), phraseTextAfterRTL)) {
      introducedAtFunction = 'linesToAssText / analyzeTextWithEmphasis token emission';
      before = lines.join(' ');
      after = phraseTextAfterRTL;
    } else if (orderChanged(phraseTextAfterRTL, finalAssText)) {
      introducedAtFunction = 'buildRtlDialogueText or ASS dialogue assembly';
      before = phraseTextAfterRTL;
      after = finalAssText;
    }

    const entry = {
      cueIndex: phraseIndex,
      phraseIndex,
      originalTranslatedText: originalTranslatedText.slice(0, 300),
      phraseWordsBeforeLayout,
      phraseWordsAfterLayout,
      phraseTextBeforeRTL,
      phraseTextAfterRTL,
      finalAssText: finalAssText.slice(0, 400),
      wordOrderChanged,
      beforeWords: wordOrderChanged ? wordsList(before) : [],
      afterWords: wordOrderChanged ? wordsList(after) : [],
      introducedAtFunction,
      before: before.slice(0, 300),
      after: after.slice(0, 300),
      layoutMode: cueLineLayout.mode,
      assLines: trace.assLines,
      emphasisWords: trace.bodyResult?.emphasisWords || []
    };

    cues.push(entry);
    if (wordOrderChanged && !firstCorruption) {
      firstCorruption = {
        cueIndex: phraseIndex,
        introducedAtFunction,
        before: before.slice(0, 300),
        after: after.slice(0, 300),
        wordOrderChanged: true
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    presetId,
    phraseCueCount: phraseCues.length,
    rtlPhraseSamples: cues.length,
    first20RtlPhraseCues: cues,
    firstCorruption,
    traceChain: [
      'translatedText (segment or matched source)',
      'buildPhraseBurnSubtitles → phrase.text / phrase.words',
      'buildCueLines → layoutLines (RTL single-line)',
      'linesToAssText → token order in ASS string',
      'buildRtlDialogueText → finalAssText',
      'libass BiDi render (not instrumented here)'
    ]
  };
}

export function logRtlPhraseOrderForensics(opts = {}) {
  if (!isRtlPhraseOrderForensicEnabled()) return null;
  if (!opts.exportSegments?.length) return null;

  const report = buildRtlPhraseOrderForensicsReport(opts.exportSegments, opts);

  console.log('[rtl-word-order-forensics-summary]', JSON.stringify(report.firstCorruption || { note: 'no rtl word order change in first 20 rtl cues' }));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'RTL-PHRASE-ORDER-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[rtl-phrase-order-forensics] write failed:', err?.message);
    }
  }

  return report;
}
