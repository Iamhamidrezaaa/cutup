/**
 * Post-translation subtitle content pipeline (no ASS / RTL / visual code).
 * Translation quality, script contamination, cue merging, timing audit.
 */
import { decodeSubtitleTextEntities } from './subtitle-text-entities.js';

const PERSIAN_TARGET = new Set(['fa', 'fas', 'per', 'persian', 'farsi']);

const FOREIGN_SCRIPT_CHECKS = [
  { id: 'devanagari', label: 'Devanagari (Hindi etc.)', re: /[\u0900-\u097F]/ },
  { id: 'han', label: 'CJK (Chinese)', re: /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/ },
  { id: 'hiragana_katakana', label: 'Japanese', re: /[\u3040-\u30FF\u31F0-\u31FF]/ },
  { id: 'hangul', label: 'Korean', re: /[\uAC00-\uD7AF\u1100-\u11FF]/ },
  { id: 'thai', label: 'Thai', re: /[\u0E00-\u0E7F]/ },
  { id: 'cyrillic', label: 'Cyrillic', re: /[\u0400-\u04FF]/ }
];

/** Vietnamese-heavy Latin diacritics (e.g. vì, được). */
const VIETNAMESE_LATIN_RE =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/;

const PERSIAN_SCRIPT_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const SENTENCE_END_RE = /[.!?؟…]["')\]]?\s*$/u;

export function isPersianTargetLanguage(targetLanguage) {
  const t = String(targetLanguage || '')
    .toLowerCase()
    .trim()
    .slice(0, 8);
  return PERSIAN_TARGET.has(t) || t.startsWith('fa');
}

export function isPipelineTraceEnabled() {
  const f = String(process.env.SUBTITLE_PIPELINE_TRACE || '').toLowerCase();
  return f === '1' || f === 'true' || f === 'yes';
}

function normalizeText(text) {
  return decodeSubtitleTextEntities(
    String(text || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function countWords(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

/**
 * @param {string} text
 * @param {string} targetLanguage
 * @returns {{ contaminated: boolean, hits: object[], latinLetters: boolean }}
 */
export function detectForeignContamination(text, targetLanguage) {
  const t = normalizeText(text);
  const hits = [];
  if (!t) return { contaminated: false, hits: [], latinLetters: false };

  for (const check of FOREIGN_SCRIPT_CHECKS) {
    if (check.re.test(t)) {
      const sample = t.match(check.re)?.[0] || '';
      hits.push({ script: check.id, label: check.label, sample });
    }
  }

  if (VIETNAMESE_LATIN_RE.test(t)) {
    const sample = t.match(VIETNAMESE_LATIN_RE)?.[0] || '';
    hits.push({ script: 'vietnamese_latin', label: 'Vietnamese diacritics', sample });
  }

  const latinLetters = /[A-Za-z]/.test(t);
  if (isPersianTargetLanguage(targetLanguage) && latinLetters) {
    const sample = t.match(/[A-Za-z]+/)?.[0] || '';
    hits.push({ script: 'latin', label: 'Latin letters (English etc.)', sample });
  }

  return { contaminated: hits.length > 0, hits, latinLetters };
}

/**
 * Strip foreign script runs from Persian cue text (preserves Persian punctuation).
 * @returns {{ text: string, stripped: object[] }}
 */
function isPersianOnlyWord(word) {
  const w = String(word || '').trim();
  if (!w) return false;
  if (FOREIGN_SCRIPT_CHECKS.some((c) => c.re.test(w))) return false;
  if (VIETNAMESE_LATIN_RE.test(w)) return false;
  if (/[A-Za-z]/.test(w)) return false;
  if (PERSIAN_SCRIPT_RE.test(w)) return true;
  return /^[\d.,!?؟…،؛:;'"()[\]\-–—]+$/u.test(w);
}

export function stripForeignScripts(text, targetLanguage) {
  if (!isPersianTargetLanguage(targetLanguage)) {
    return { text: normalizeText(text), stripped: [] };
  }
  const before = normalizeText(text);
  const stripped = [];
  const words = before.split(/\s+/).filter(Boolean);
  const kept = [];
  for (const w of words) {
    if (isPersianOnlyWord(w)) {
      kept.push(w);
    } else {
      stripped.push({ word: w, reason: detectForeignContamination(w, targetLanguage).hits });
    }
  }
  return { text: kept.join(' ').trim(), stripped };
}

/**
 * @param {{ start: number, end: number, text: string }[]} segments
 * @param {string} targetLanguage
 */
export function validatePersianCueScripts(segments, targetLanguage) {
  if (!isPersianTargetLanguage(targetLanguage)) {
    return { ok: true, violations: [] };
  }
  const violations = [];
  for (let i = 0; i < (segments || []).length; i++) {
    const text = normalizeText(segments[i]?.text);
    const det = detectForeignContamination(text, targetLanguage);
    if (det.contaminated) {
      violations.push({
        index: i,
        text,
        start: segments[i]?.start,
        end: segments[i]?.end,
        hits: det.hits,
        source: 'post-translation-segment'
      });
      console.error('[subtitle-contamination]', {
        cueIndex: i,
        text,
        hits: det.hits,
        source: 'post-translation-segment'
      });
    }
    if (text && !PERSIAN_SCRIPT_RE.test(text)) {
      violations.push({
        index: i,
        text,
        hits: [{ script: 'no_persian_script', label: 'No Persian/Arabic script letters' }],
        source: 'post-translation-segment'
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

function isFragmentCue(text) {
  const t = normalizeText(text);
  if (!t) return true;
  const words = countWords(t);
  if (words <= 2) return true;
  if (words <= 4 && t.length < 28 && !SENTENCE_END_RE.test(t)) return true;
  if (words <= 5 && !SENTENCE_END_RE.test(t) && t.length < 40) return true;
  return false;
}

function mergePair(a, b) {
  return {
    start: Number(a.start),
    end: Number(b.end),
    text: normalizeText(`${a.text} ${b.text}`)
  };
}

/**
 * Merge semantically incomplete Persian cues (preserves timing span).
 * @param {{ start: number, end: number, text: string }[]} segments
 * @param {{ maxGapSec?: number, maxChain?: number }} [opts]
 */
export function mergeFragmentedSubtitleCues(segments, opts = {}) {
  const maxGapSec = Number(opts.maxGapSec ?? 1.35);
  const maxChain = Math.max(2, Number(opts.maxChain ?? 5));
  const sorted = [...(segments || [])]
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number')
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) return [];

  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let cur = {
      start: Number(sorted[i].start),
      end: Number(sorted[i].end),
      text: normalizeText(sorted[i].text)
    };
    let chain = 1;
    let j = i + 1;

    while (j < sorted.length && chain < maxChain) {
      const next = sorted[j];
      const gap = Number(next.start) - cur.end;
      if (gap > maxGapSec) break;

      const shouldMerge =
        isFragmentCue(cur.text) ||
        isFragmentCue(next.text) ||
        (!SENTENCE_END_RE.test(cur.text) && countWords(cur.text) < 6);

      if (!shouldMerge) break;

      cur = mergePair(cur, next);
      chain += 1;
      j += 1;
    }

    out.push(cur);
    i = j;
  }

  return out;
}

export function buildPersianFluencyPrompts(batch) {
  const n = batch.length;
  const block = batch.map((s) => s.text).join('\n---SEGMENT---\n');
  const systemPrompt = `You are an expert Persian (Farsi) subtitle editor for social video. Rewrite each segment into natural, conversational Iranian Persian. Preserve meaning and speaker tone. Use ONLY Persian in the Arabic script used for Farsi. Forbidden in output: English, Hindi (Devanagari), Chinese, Japanese, Korean, Vietnamese, Urdu, or any non-Persian script. No Latin letters. Output exactly ${n} segments separated only by ---SEGMENT--- on its own line. No numbering or timestamps.`;
  const userPrompt = `Rewrite these ${n} subtitle lines for natural Persian fluency (same order, ---SEGMENT--- between lines):

${block}

Fluent Persian lines (${n} parts, delimiter only):`;
  return { systemPrompt, userPrompt };
}

/**
 * @param {object} opts
 * @param {{ start, end, text }[]} opts.originalSegments transcript English
 * @param {{ start, end, text }[]} opts.translatedSegments
 * @param {string} opts.targetLanguage
 * @param {string} opts.traceId
 * @param {Function} opts.runLlmBatch async (batch, prompts, traceId, batchIndex) => segments[]
 */
export async function postProcessTranslatedSegments(opts) {
  const {
    originalSegments = [],
    translatedSegments = [],
    targetLanguage,
    traceId,
    runLlmBatch
  } = opts;

  const tgt = String(targetLanguage || '').toLowerCase().slice(0, 2);
  let working = translatedSegments.map((s, i) => ({
    start: Number(s.start),
    end: Number(s.end),
    text: normalizeText(s.text),
    _srcIndex: i
  }));

  let traceIdx = working.findIndex((s) => detectForeignContamination(s.text, targetLanguage).contaminated);
  if (traceIdx < 0) traceIdx = 0;
  traceIdx = Math.min(traceIdx, Math.max(0, working.length - 1));

  const pipelineStages = {
    transcript: normalizeText(originalSegments[traceIdx]?.text || ''),
    translated: working[traceIdx]?.text || ''
  };

  if (isPersianTargetLanguage(targetLanguage)) {
    for (let i = 0; i < working.length; i++) {
      const det = detectForeignContamination(working[i].text, targetLanguage);
      if (!det.contaminated) continue;
      const { text: cleaned, stripped } = stripForeignScripts(working[i].text, targetLanguage);
      console.warn('[subtitle-contamination-stripped]', {
        traceId,
        cueIndex: i,
        before: working[i].text,
        after: cleaned,
        hits: det.hits,
        stripped
      });
      working[i] = { ...working[i], text: cleaned || working[i].text };
    }
    pipelineStages.afterContaminationCheck = working[traceIdx]?.text || '';

    const scriptCheck = validatePersianCueScripts(working, targetLanguage);
    if (!scriptCheck.ok) {
      console.error('[subtitle-contamination-summary]', {
        traceId,
        violationCount: scriptCheck.violations.length,
        sample: scriptCheck.violations.slice(0, 5)
      });
    }

    if (typeof runLlmBatch === 'function' && String(process.env.PERSIAN_FLUENCY_PASS ?? '1') !== '0') {
      const batchSize = 15;
      const fluent = [];
      for (let i = 0; i < working.length; i += batchSize) {
        const batch = working.slice(i, i + batchSize);
        const prompts = buildPersianFluencyPrompts(batch);
        const rewritten = await runLlmBatch(
          batch,
          prompts,
          traceId,
          `fluency-${Math.floor(i / batchSize) + 1}`,
          { temperature: 0.35 }
        );
        for (let j = 0; j < rewritten.length; j++) {
          fluent.push({
            start: Number(batch[j]?.start ?? rewritten[j].start),
            end: Number(batch[j]?.end ?? rewritten[j].end),
            text: normalizeText(rewritten[j]?.text)
          });
        }
      }
      if (fluent.length === working.length) {
        working = fluent;
      }
      pipelineStages.afterFluency = working[traceIdx]?.text || '';
    }

    const beforeMerge = working.length;
    working = mergeFragmentedSubtitleCues(working);
    console.log('[subtitle-cue-merge]', {
      traceId,
      before: beforeMerge,
      after: working.length,
      mergedAway: beforeMerge - working.length
    });
    pipelineStages.afterMerge = working[traceIdx]?.text || '';
    pipelineStages.exportText = pipelineStages.afterMerge;
  } else {
    pipelineStages.exportText = working[traceIdx]?.text || '';
  }

  const timingReport = buildTimingDriftReport(originalSegments, translatedSegments, working, traceId);

  if (isPipelineTraceEnabled()) {
    console.log(
      '[subtitle-pipeline-trace]',
      JSON.stringify(
        {
          traceId,
          cueIndex: traceIdx,
          targetLanguage: tgt,
          stages: pipelineStages
        },
        null,
        0
      )
    );
  }

  return {
    segments: working.map(({ start, end, text }) => ({ start, end, text })),
    timingReport,
    pipelineStages
  };
}

/**
 * Compare timestamps: 1:1 translate vs final cues (after merge).
 */
export function buildTimingDriftReport(originalEnglish, translatedOneToOne, finalCues, traceId) {
  const rows = [];
  let maxDriftMs = 0;
  let leadSum = 0;
  let lagSum = 0;
  let leadN = 0;
  let lagN = 0;

  const n = Math.min(12, finalCues.length);
  for (let i = 0; i < n; i++) {
    const fin = finalCues[i];
    const origIdx = Math.min(i, (originalEnglish?.length || 1) - 1);
    const orig = originalEnglish[origIdx];
    const startDriftMs = Math.round((Number(fin.start) - Number(orig?.start ?? fin.start)) * 1000);
    const endDriftMs = Math.round((Number(fin.end) - Number(orig?.end ?? fin.end)) * 1000);
    maxDriftMs = Math.max(maxDriftMs, Math.abs(startDriftMs), Math.abs(endDriftMs));
    if (startDriftMs > 0) {
      lagSum += startDriftMs;
      lagN += 1;
    } else if (startDriftMs < 0) {
      leadSum += Math.abs(startDriftMs);
      leadN += 1;
    }
    rows.push({
      index: i,
      text: String(fin.text || '').slice(0, 60),
      originalStart: orig?.start,
      originalEnd: orig?.end,
      finalStart: fin.start,
      finalEnd: fin.end,
      startDriftMs,
      endDriftMs,
      note:
        i >= translatedOneToOne.length
          ? 'cue merged — timing spans first..last of merged chain'
          : '1:1 translate timing preserved until merge'
    });
  }

  const report = {
    traceId,
    finalCueCount: finalCues.length,
    translatedOneToOneCount: translatedOneToOne.length,
    maximumDriftMs: maxDriftMs,
    averageSubtitleLagMs: lagN ? Math.round(lagSum / lagN) : 0,
    averageSubtitleLeadMs: leadN ? Math.round(leadSum / leadN) : 0,
    translationPreservesTimestamps: true,
    mergeAltersCueCount: finalCues.length !== translatedOneToOne.length,
    exportBurnNote:
      'Export may apply BURN_LEAD_DELAY_SEC in buildSourceAlignedSubtitles — not modified here',
    sampleRows: rows
  };

  console.log('[subtitle-timing-integrity]', JSON.stringify(report, null, 0));
  return report;
}
