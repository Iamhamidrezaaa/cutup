/**
 * Subtitle pipeline with strict source-of-truth preservation.
 * Styling layers must never mutate transcript semantics.
 */
import { decodeSubtitleTextEntities } from '../subtitle-text-entities.js';
import { applyWhisperLeadingOffsetIfNeeded } from '../whisper-leading-offset.js';
import { layoutLines } from './text-layout.js';
import { splitWordsByCharBudget } from './subtitle-width-fit.js';
import { isRtlText } from './rtl-text.js';

export const CAPTION_QUALITY_MODES = Object.freeze({
  ACCURATE: 'accurate',
  CLEAN: 'clean',
  VIRAL: 'viral'
});

/** @type {object[]|null} Read-only phrase timing forensic rows (PHRASE_TIMING_FORENSIC=1). */
let _phraseTimingComposeForensicRows = null;

export function beginPhraseTimingForensicCapture() {
  _phraseTimingComposeForensicRows = [];
}

export function isPhraseTimingForensicCaptureActive() {
  return _phraseTimingComposeForensicRows !== null;
}

export function getPhraseTimingComposeForensicRows() {
  return _phraseTimingComposeForensicRows ? [..._phraseTimingComposeForensicRows] : [];
}

export function endPhraseTimingForensicCapture() {
  const rows = getPhraseTimingComposeForensicRows();
  _phraseTimingComposeForensicRows = null;
  return rows;
}

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const FILLER = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'and', 'or', 'but',
  'so', 'if', 'as', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this', 'that'
]);
const DRAMATIC = new Set(['never', 'stop', 'now', 'insane', 'wait', 'you', 'this', 'crazy', 'secret']);
const PHONETIC_CONFUSIONS = {
  think: ['sink'],
  sink: ['think'],
  three: ['tree'],
  tree: ['three'],
  then: ['den'],
  den: ['then'],
  this: ['dis'],
  dis: ['this']
};
const CONTEXTUAL_PHRASES = [
  { context: ['pull', 'up'], from: 'sink', to: 'ups' },
  { context: ['right', 'now'], from: 'den', to: 'then' },
  { context: ['is', 'the'], from: 'tree', to: 'three' }
];

function normalizeCueText(text) {
  return decodeSubtitleTextEntities(
    String(text || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
  );
}

function cueWords(text) {
  return String(text || '').match(TOKEN_RE) || [];
}

function normalizeWord(w) {
  return String(w || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}$%]/gu, '');
}

function phoneticKey(word) {
  return normalizeWord(word)
    .replace(/th/g, 't')
    .replace(/[aeiou]/g, '')
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const m = s.length;
  const n = t.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

function applyModelVoting(wordObj, opts) {
  if (!opts.enableModelVoting) return wordObj;
  const candidates = Array.isArray(wordObj.candidates) ? wordObj.candidates : [];
  if (!candidates.length) return wordObj;
  const ranked = candidates
    .map((c) => ({
      word: String(c.word || c.text || '').trim(),
      confidence: Number.isFinite(Number(c.confidence)) ? Number(c.confidence) : -1
    }))
    .filter((c) => c.word)
    .sort((a, b) => b.confidence - a.confidence);
  if (!ranked.length) return wordObj;
  return {
    ...wordObj,
    word: ranked[0].word,
    cleanWord: normalizeWord(ranked[0].word),
    confidence: ranked[0].confidence >= 0 ? ranked[0].confidence : wordObj.confidence,
    correctionReason: ranked[0].word !== wordObj.word ? 'model_voting' : wordObj.correctionReason
  };
}

function applyPhoneticAndContextCorrection(wordsTimeline, opts) {
  const out = wordsTimeline.map((w) => ({ ...w }));
  const logs = [];
  const confThreshold = opts.lowConfidenceThreshold;

  for (let i = 0; i < out.length; i++) {
    let cur = out[i];
    cur = applyModelVoting(cur, opts);
    const originalWord = cur.word;
    const clean = normalizeWord(cur.word);
    const lowConf = cur.confidence != null && cur.confidence < confThreshold;
    let corrected = clean;
    let correctionReason = null;
    let phoneticMatch = null;

    if (lowConf) {
      const candidates = PHONETIC_CONFUSIONS[clean] || [];
      for (const cand of candidates) {
        const dist = levenshtein(phoneticKey(clean), phoneticKey(cand));
        if (dist <= 1) {
          corrected = cand;
          correctionReason = 'phonetic_low_conf';
          phoneticMatch = cand;
          break;
        }
      }
      const prev = normalizeWord(out[i - 1]?.word);
      const next = normalizeWord(out[i + 1]?.word);
      for (const rule of CONTEXTUAL_PHRASES) {
        if (rule.from !== corrected) continue;
        if ((rule.context[0] === prev && rule.context[1] === next) || (rule.context[0] === prev)) {
          corrected = rule.to;
          correctionReason = 'contextual_phrase';
          break;
        }
      }
    }

    out[i] = {
      ...cur,
      suspicious: lowConf,
      word: corrected || cur.word,
      cleanWord: normalizeWord(corrected || cur.word)
    };
    if (lowConf || correctionReason) {
      logs.push({
        originalWord,
        correctedWord: out[i].word,
        confidence: cur.confidence,
        correctionReason: correctionReason || 'low_confidence_only',
        phoneticMatch,
        neighboringWords: [out[i - 1]?.word || null, out[i + 1]?.word || null]
      });
    }
  }

  return { words: out, logs };
}

function detectEmphasisWords(text) {
  const wordsList = cueWords(text);
  const ranked = wordsList
    .map((w, i) => {
      const n = normalizeWord(w);
      if (!n || FILLER.has(n)) return null;
      let score = 0;
      if (DRAMATIC.has(n)) score += 4;
      if (/\d/.test(n)) score += 3;
      if (/^\$|%$/.test(n)) score += 3;
      if (n.length <= 4) score += 1.2;
      if (/ed$|ing$/.test(n)) score += 1.1; // rough verb bias
      if (/^[A-Z]/.test(w)) score += 0.7; // names/proper nouns
      if (i === 0) score += 0.5;
      return { raw: w, norm: n, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const top = [];
  for (const r of ranked) {
    if (top.length >= 2) break;
    if (r.score < 2.2) break;
    if (!top.includes(r.norm)) top.push(r.norm);
  }
  return top;
}

function normalizeWordTimeline(rawSegments, opts = {}) {
  const minWordDur = 0.06;
  const overlapGuard = 0.01;
  const tinyGap = 0.04;
  const out = [];

  for (const seg of Array.isArray(rawSegments) ? rawSegments : []) {
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) continue;
    const segStart = Number(seg.start);
    const segEnd = Number(seg.end);
    const sourceWords = Array.isArray(seg.words) && seg.words.length ? seg.words : null;

    if (sourceWords) {
      for (const w of sourceWords) {
        const word = String(w.word || w.text || '').trim();
        if (!word) continue;
        let ws = Number(w.start);
        let we = Number(w.end);
        if (!Number.isFinite(ws)) ws = segStart;
        if (!Number.isFinite(we)) we = ws + minWordDur;
        ws = Math.max(segStart, ws);
        we = Math.min(segEnd, Math.max(ws + minWordDur, we));
        out.push({
          word,
          cleanWord: normalizeWord(word),
          start: ws,
          end: we,
          duration: Number((we - ws).toFixed(3)),
          confidence: Number.isFinite(Number(w.confidence)) ? Number(w.confidence) : null
        });
      }
      continue;
    }

    const tokens = cueWords(seg.text || '');
    if (!tokens.length) continue;
    const dur = Math.max(minWordDur * tokens.length, segEnd - segStart);
    const per = dur / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      const ws = segStart + i * per;
      const we = Math.min(segEnd, Math.max(ws + minWordDur, segStart + (i + 1) * per));
      out.push({
        word: tokens[i],
        cleanWord: normalizeWord(tokens[i]),
        start: ws,
        end: we,
        duration: Number((we - ws).toFixed(3)),
        confidence: null
      });
    }
  }

  out.sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    const prev = out[i - 1];
    if (prev && cur.start < prev.end - overlapGuard) {
      cur.start = prev.end - overlapGuard;
    }
    if (prev) {
      const gap = cur.start - prev.end;
      if (gap >= 0 && gap < tinyGap) {
        const mid = prev.end + gap / 2;
        prev.end = mid;
        cur.start = mid;
      }
    }
    cur.end = Math.max(cur.start + minWordDur, cur.end);
    cur.duration = Number((cur.end - cur.start).toFixed(3));
  }

  const corrected = applyPhoneticAndContextCorrection(out, {
    lowConfidenceThreshold: Number(opts.lowConfidenceThreshold ?? 0.62),
    enableModelVoting: Boolean(opts.enableModelVoting)
  });

  // Timing smoothing for suspicious/low-confidence words.
  for (let i = 0; i < corrected.words.length; i++) {
    const cur = corrected.words[i];
    if (!cur.suspicious) continue;
    const prev = corrected.words[i - 1];
    const next = corrected.words[i + 1];
    if (prev && prev.confidence != null && prev.confidence >= 0.7) {
      cur.start = Math.max(cur.start, prev.end - 0.02);
    }
    if (next && next.confidence != null && next.confidence >= 0.7) {
      cur.end = Math.min(cur.end, next.start + 0.02);
    }
    cur.end = Math.max(cur.start + minWordDur, cur.end);
    cur.duration = Number((cur.end - cur.start).toFixed(3));
  }

  return corrected;
}

function toCanonicalCue(seg, index) {
  if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) return null;
  const text = normalizeCueText(seg.text || '');
  if (!text) return null;
  return {
    id: `cue_${index}`,
    index,
    start: Number(seg.start),
    end: Number(seg.end),
    text,
    _words: cueWords(text)
  };
}

function splitPhraseToWordChunks(wordsList, maxWords = 5) {
  const chunks = [];
  let bucket = [];
  for (const w of wordsList) {
    bucket.push(w);
    if (bucket.length >= maxWords || /[.!?,:;]$/.test(w)) {
      chunks.push(bucket.join(' '));
      bucket = [];
    }
  }
  if (bucket.length) chunks.push(bucket.join(' '));
  return chunks;
}

function normalizeForAccumulation(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Speech-rate helpers (words per second). */
function wordsPerSecond(wordCount, spanSec) {
  return wordCount / Math.max(0.05, spanSec);
}

function globalSpeechRateWps(timeline) {
  if (!timeline?.length) return 3;
  if (timeline.length === 1) return 3;
  return wordsPerSecond(timeline.length, timeline[timeline.length - 1].end - timeline[0].start);
}

function silenceGapThresholdSec(speechRate) {
  if (speechRate > 3.5) return 0.12;
  if (speechRate < 2.2) return 0.26;
  return 0.18;
}

/** Viral phrase split guard — one visual line per cue (stable burn position). */
const VIRAL_PHRASE_LAYOUT = Object.freeze({
  maxLines: 1,
  wordsPerLineMin: 1,
  wordsPerLineMax: 8,
  maxCharsPerLine: 28,
  mode: 'single'
});

const SYNC_PREROLL_MAX_SEC = 0.025;
const SYNC_TAIL_MAX_SEC = 0.04;
const SYNC_OVERLAP_GAP_SEC = 0.015;
const SYNC_MIN_FLASH_SEC = 0.25;
const SYNC_MAX_CAPTION_SEC = 4;
const SYNC_HIGH_CONF = 0.55;

function adaptivePaddingFromSpeechRate(speechRate) {
  const fast = speechRate > 3.5;
  const slow = speechRate < 2.2;
  const preroll = fast ? 0.008 : slow ? 0.022 : 0.014;
  const tail = fast ? 0.012 : slow ? 0.034 : 0.02;
  return {
    preroll: Math.min(SYNC_PREROLL_MAX_SEC, preroll),
    tail: Math.min(SYNC_TAIL_MAX_SEC, tail)
  };
}

/** High-confidence words anchor caption boundaries (low-confidence excluded when possible). */
function speechAnchorStart(chunkMeta) {
  const sorted = [...chunkMeta].sort((a, b) => a.start - b.start);
  const backbone = sorted.filter((w) => w.confidence == null || w.confidence >= SYNC_HIGH_CONF);
  const pool = backbone.length ? backbone : sorted;
  return pool[0].start;
}

function speechAnchorEnd(chunkMeta) {
  const sorted = [...chunkMeta].sort((a, b) => a.end - b.end);
  const backbone = sorted.filter((w) => w.confidence == null || w.confidence >= SYNC_HIGH_CONF);
  const pool = backbone.length ? backbone : sorted;
  return pool[pool.length - 1].end;
}

function reanchorBlockTiming(block, timingOpts = {}) {
  const meta = block.wordTimeline || [];
  if (!meta.length) return block;
  const speechAnchor = speechAnchorStart(meta);
  const lastWordEnd = speechAnchorEnd(meta);
  const speechRate = wordsPerSecond(meta.length, lastWordEnd - speechAnchor);
  const pad = adaptivePaddingFromSpeechRate(speechRate);
  const useTightSync = timingOpts.tightSync !== false;
  let phraseStartAfterReanchor = useTightSync
    ? Math.max(0, speechAnchor)
    : Math.max(0, speechAnchor - pad.preroll);
  if (timingOpts.forceStartAtZero) {
    phraseStartAfterReanchor = 0;
  } else if (
    Number.isFinite(Number(block.segmentStart)) &&
    Number(block.segmentStart) <= 0.2 &&
    speechAnchor <= 0.35
  ) {
    phraseStartAfterReanchor = 0;
  }
  if (isPhraseTimingForensicCaptureActive()) {
    block._phraseTimingTrace = {
      ...(block._phraseTimingTrace || {}),
      speechAnchorStart: speechAnchor,
      firstWordStart: speechAnchor,
      prerollSec: pad.preroll,
      tailPadSec: pad.tail,
      phraseStartBeforeReanchor: speechAnchor,
      phraseStartAfterReanchor,
      blockStartBeforeReanchor: Number.isFinite(Number(block.start)) ? Number(block.start) : null
    };
  }
  return {
    ...block,
    firstWordStart: speechAnchor,
    lastWordEnd,
    speechRate,
    adjustedStart: phraseStartAfterReanchor,
    adjustedEnd: lastWordEnd + pad.tail,
    start: phraseStartAfterReanchor,
    end: lastWordEnd + pad.tail
  };
}

function shouldForceCaptionBoundary(prevWord, nextWord, gapSec, speechRate, chunkLen, maxWords) {
  const thresh = silenceGapThresholdSec(speechRate);
  if (gapSec >= thresh) return { break: true, reason: 'silence_gap' };
  const prevText = String(prevWord?.word || '');
  if (/[.!?…]["']?$/.test(prevText)) return { break: true, reason: 'punctuation' };
  if (/[,;:]["']?$/.test(prevText) && chunkLen >= 2) return { break: true, reason: 'punctuation_soft' };
  if (gapSec >= thresh * 0.55 && chunkLen >= 3) return { break: true, reason: 'phonetic_pause' };
  if (chunkLen >= maxWords) return { break: true, reason: 'max_words' };
  return { break: false, reason: null };
}

function eliminateCaptionOverlaps(blocks, minGapSec = SYNC_OVERLAP_GAP_SEC) {
  const list = Array.isArray(blocks) ? blocks : [];
  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i];
    const next = list[i + 1];
    const maxEnd = next.start - minGapSec;
    if (cur.end > maxEnd) {
      cur.end = Math.max(cur.start + 0.08, maxEnd);
      cur.adjustedEnd = cur.end;
    }
  }
  return list;
}

function detectAndCorrectDrift(blocks) {
  let rollingDrift = 0;
  for (const b of blocks) {
    b.driftCorrectionApplied = 0;
    const meta = b.wordTimeline || [];
    if (!meta.length) continue;
    const pad = adaptivePaddingFromSpeechRate(b.speechRate || 3);
    const expectedStart = speechAnchorStart(meta) - pad.preroll;
    const expectedEnd = speechAnchorEnd(meta) + pad.tail;
    const startErr = b.start - expectedStart;
    const endErr = b.end - expectedEnd;
    rollingDrift += startErr * 0.5 + endErr * 0.5;
    if (Math.abs(rollingDrift) > 0.1) {
      const correction = -rollingDrift * 0.55;
      const startBeforeDrift = b.start;
      b.start = Math.max(0, b.start + correction);
      b.end = Math.max(b.start + 0.08, b.end + correction);
      b.adjustedStart = b.start;
      b.adjustedEnd = b.end;
      b.driftCorrectionApplied = Number(correction.toFixed(4));
      if (isPhraseTimingForensicCaptureActive()) {
        b._phraseTimingTrace = {
          ...(b._phraseTimingTrace || {}),
          phraseStartBeforeDrift: startBeforeDrift,
          phraseStartAfterDrift: b.start,
          driftCorrectionSec: b.driftCorrectionApplied
        };
      }
      rollingDrift *= 0.25;
    }
  }
  return blocks;
}

function applySpeechRatePersistence(blocks) {
  for (const b of blocks) {
    const sr = b.speechRate || 3;
    const pad = adaptivePaddingFromSpeechRate(sr);
    const anchorDur = Math.max(0.05, b.lastWordEnd - b.firstWordStart);
    if (sr > 3.5) {
      b.end = Math.min(b.end, b.lastWordEnd + Math.min(pad.tail, 0.018));
    } else if (sr < 2.2) {
      b.end = Math.min(b.end, b.lastWordEnd + pad.tail);
    }
    b.end = Math.max(b.start + anchorDur * 0.85, b.end);
    if (b.end - b.start > SYNC_MAX_CAPTION_SEC) {
      b.end = b.start + SYNC_MAX_CAPTION_SEC;
    }
    b.adjustedEnd = b.end;
  }
  return blocks;
}

function splitLongBlockOnWordBoundaries(block, maxDurationSec) {
  const meta = block.wordTimeline || [];
  if (!meta.length || block.end - block.start <= maxDurationSec) return [block];
  const parts = [];
  let chunk = [];
  for (let i = 0; i < meta.length; i++) {
    chunk.push(meta[i]);
    const span = chunk[chunk.length - 1].end - chunk[0].start;
    const atEnd = i === meta.length - 1;
    const next = meta[i + 1];
    const gap = next ? next.start - meta[i].end : 0;
    const boundary =
      atEnd ||
      span >= maxDurationSec ||
      (gap >= silenceGapThresholdSec(block.speechRate || 3) && chunk.length >= 2);
    if (boundary) {
      const text = chunk.map((w) => w.word).join(' ');
      parts.push(
        reanchorBlockTiming({
          ...block,
          text: normalizeCueText(text),
          words: cueWords(text),
          wordTimeline: [...chunk]
        })
      );
      chunk = [];
    }
  }
  return parts.length ? parts : [block];
}

function logCaptionSyncDebug(captions) {
  console.log(
    '[caption-sync-debug]',
    captions.map((c) => {
      const meta = c.wordTimeline || [];
      const first = meta[0];
      const last = meta[meta.length - 1];
      return {
        text: c.text,
        firstWord: first?.word ?? null,
        lastWord: last?.word ?? null,
        firstWordStart: c.firstWordStart,
        lastWordEnd: c.lastWordEnd,
        finalCaptionStart: c.start,
        finalCaptionEnd: c.end,
        speechRate: c.speechRate,
        detectedGap: c.boundaryGap ?? null,
        boundaryReason: c.boundaryReason ?? null,
        driftCorrectionApplied: c.driftCorrectionApplied ?? 0
      };
    })
  );
}

/**
 * Export-time sanity checks before ASS generation (auto-fix where possible).
 * @param {object[]} captions
 */
export function validateAndFixCaptionTimingForExport(captions) {
  const list = (Array.isArray(captions) ? captions : []).map((c) => ({ ...c }));
  const report = { fixed: [], warnings: [] };

  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (isPhraseTimingForensicCaptureActive() && _phraseTimingComposeForensicRows[i]) {
      _phraseTimingComposeForensicRows[i].beforeValidateExportStart = Number(c.start);
    }
    if (c.end <= c.start) {
      c.end = c.start + SYNC_MIN_FLASH_SEC;
      report.fixed.push(`negative_duration_${i}`);
    }
    const dur = c.end - c.start;
    if (dur < SYNC_MIN_FLASH_SEC) {
      const next = list[i + 1];
      const room = next ? Math.max(0, next.start - SYNC_OVERLAP_GAP_SEC - c.start) : SYNC_MIN_FLASH_SEC;
      const target = Math.min(SYNC_MIN_FLASH_SEC, room > 0.08 ? room : SYNC_MIN_FLASH_SEC);
      c.end = c.start + target;
      report.fixed.push(`short_flash_${i}`);
    }
    if (dur > SYNC_MAX_CAPTION_SEC) {
      c.end = c.start + SYNC_MAX_CAPTION_SEC;
      report.fixed.push(`long_caption_${i}`);
    }
  }

  eliminateCaptionOverlaps(list, SYNC_OVERLAP_GAP_SEC);

  for (let i = 0; i < list.length - 1; i++) {
    if (list[i].end > list[i + 1].start - SYNC_OVERLAP_GAP_SEC) {
      report.warnings.push(`overlap_residual_${i}`);
    }
  }

  if (isPhraseTimingForensicCaptureActive()) {
    for (let i = 0; i < list.length; i++) {
      if (_phraseTimingComposeForensicRows[i]) {
        _phraseTimingComposeForensicRows[i].afterValidateAndFixCaptionTimingForExportStart = Number(
          list[i].start
        );
      }
    }
  }

  if (report.fixed.length || report.warnings.length) {
    console.log('[caption-sync-validation]', report);
  }
  return list;
}

function resolveSegmentIds(seg, index) {
  const translatedSegmentId =
    seg.translatedSegmentId != null
      ? String(seg.translatedSegmentId)
      : seg.id != null
        ? String(seg.id)
        : `translated_${index}`;
  const sourceSegmentId =
    seg.sourceSegmentId != null
      ? String(seg.sourceSegmentId)
      : seg.sourceId != null
        ? String(seg.sourceId)
        : translatedSegmentId;
  return { sourceSegmentId, translatedSegmentId, segmentIndex: index };
}

function collapseProgressiveTranslatedSegments(rawSegments) {
  const out = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) {
      continue;
    }
    const text = normalizeCueText(seg.text || '');
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const prevNorm = normalizeForAccumulation(prev.text);
      const nextNorm = normalizeForAccumulation(text);
      const growing = nextNorm.startsWith(prevNorm) && nextNorm.length > prevNorm.length;
      const near = Number(seg.start) <= Number(prev.end) + 0.3;
      if (growing && near) {
        prev.end = Math.max(Number(prev.end), Number(seg.end));
        prev.text = text;
        if (Array.isArray(seg.words) && seg.words.length) prev.words = seg.words;
        continue;
      }
    }
    out.push({ ...seg, text });
  }
  return out;
}

function phraseVisualLineCount(text, layout = VIRAL_PHRASE_LAYOUT) {
  const lines = layoutLines(normalizeCueText(text), layout);
  return lines.filter(Boolean).length;
}

function buildSegmentTextOrderedTimeline(seg) {
  const segStart = Number(seg.start);
  const segEnd = Number(seg.end);
  const text = normalizeCueText(seg.text || '');
  const tokens = cueWords(text);
  if (!tokens.length) return [];

  const minWordDur = 0.06;
  const sourceWords = Array.isArray(seg.words) && seg.words.length ? seg.words : null;
  const out = [];

  if (sourceWords) {
    let srcIdx = 0;
    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti];
      while (
        srcIdx < sourceWords.length &&
        normalizeWord(sourceWords[srcIdx]?.word || sourceWords[srcIdx]?.text) !== normalizeWord(token)
      ) {
        srcIdx += 1;
      }
      const raw = sourceWords[srcIdx] || null;
      let ws = Number(raw?.start);
      let we = Number(raw?.end);
      if (!Number.isFinite(ws)) ws = segStart;
      if (!Number.isFinite(we)) we = ws + minWordDur;
      ws = Math.max(segStart, ws);
      we = Math.min(segEnd, Math.max(ws + minWordDur, we));
      out.push({
        word: token,
        cleanWord: normalizeWord(token),
        start: ws,
        end: we,
        duration: Number((we - ws).toFixed(3)),
        confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : null
      });
      if (raw) srcIdx += 1;
    }
  } else {
    const dur = Math.max(minWordDur * tokens.length, segEnd - segStart);
    const per = dur / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      const ws = segStart + i * per;
      const we = Math.min(segEnd, Math.max(ws + minWordDur, segStart + (i + 1) * per));
      out.push({
        word: tokens[i],
        cleanWord: normalizeWord(tokens[i]),
        start: ws,
        end: we,
        duration: Number((we - ws).toFixed(3)),
        confidence: null
      });
    }
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (cur.start < prev.end - 0.01) cur.start = prev.end - 0.01;
    cur.end = Math.max(cur.start + minWordDur, cur.end);
    cur.duration = Number((cur.end - cur.start).toFixed(3));
  }
  return out;
}

function subdividePhraseSpec(spec, allWords, layout = VIRAL_PHRASE_LAYOUT) {
  const subTokens = allWords.slice(spec.tokenStart, spec.tokenEnd + 1);
  if (subTokens.length <= 1) {
    return [{ ...spec, boundaryReason: spec.boundaryReason || 'max_one_line' }];
  }
  const pivot = Math.max(1, Math.round(subTokens.length / 2));
  const left = {
    text: subTokens.slice(0, pivot).join(' '),
    tokenStart: spec.tokenStart,
    tokenEnd: spec.tokenStart + pivot - 1,
    boundaryReason: 'max_one_line_split'
  };
  const right = {
    text: subTokens.slice(pivot).join(' '),
    tokenStart: spec.tokenStart + pivot,
    tokenEnd: spec.tokenEnd,
    boundaryReason: 'max_one_line_split'
  };
  const out = [];
  for (const part of [left, right]) {
    if (phraseVisualLineCount(part.text, layout) > 1 && cueWords(part.text).length > 1) {
      out.push(...subdividePhraseSpec(part, allWords, layout));
    } else {
      out.push(part);
    }
  }
  return out;
}

function splitSegmentTextIntoPhrases(segmentText, opts = {}) {
  const text = normalizeCueText(segmentText);
  const w = cueWords(text);
  if (!w.length) return [];

  const baseMaxWords = Math.max(2, Math.min(5, Number(opts.maxWordsPerPhrase ?? opts.maxWordsPerBlock ?? 4)));
  const layout = opts.phraseLayout || VIRAL_PHRASE_LAYOUT;
  const rawPieces = [];
  let bucketStart = 0;

  for (let i = 0; i < w.length; i++) {
    const token = w[i];
    const chunkLen = i - bucketStart + 1;
    const hitPunctStrong = /[.!?…]["']?$/.test(token);
    const hitPunctSoft = /[,;:]["']?$/.test(token) && chunkLen >= 2;
    const hitMaxWords = chunkLen >= baseMaxWords;
    const atEnd = i === w.length - 1;

    if (hitPunctStrong || hitPunctSoft || hitMaxWords || atEnd) {
      rawPieces.push({
        text: w.slice(bucketStart, i + 1).join(' '),
        tokenStart: bucketStart,
        tokenEnd: i,
        boundaryReason: hitPunctStrong
          ? 'punctuation'
          : hitPunctSoft
            ? 'punctuation_soft'
            : hitMaxWords
              ? 'max_words'
              : 'segment_end'
      });
      bucketStart = i + 1;
    }
  }

  const final = [];
  for (const piece of rawPieces) {
    if (phraseVisualLineCount(piece.text, layout) > 1) {
      final.push(...subdividePhraseSpec(piece, w, layout));
    } else {
      final.push(piece);
    }
  }
  return final;
}

function clampFirstPhraseCueTiming(smoothed, firstSeg) {
  if (!smoothed.length) return;
  const fc = smoothed[0];
  const meta0 = fc.wordTimeline?.[0];
  if (meta0 && Number.isFinite(Number(meta0.start)) && Number(meta0.start) < fc.start - 0.02) {
    const anchor = Math.max(0, Number(meta0.start));
    fc.start = anchor;
    fc.adjustedStart = anchor;
    fc.firstWordStart = anchor;
  }
  const fw = Number(fc.firstWordStart ?? fc.start);
  if (fw <= 0.25) {
    fc.start = 0;
    fc.adjustedStart = 0;
    fc.firstWordStart = Math.max(0, fw);
  }
  if (
    firstSeg &&
    meta0 &&
    Number(firstSeg.start) > 0.5 &&
    Number(meta0.start) < Number(firstSeg.start) - 0.15
  ) {
    const anchor = Math.max(0, Number(meta0.start));
    fc.start = anchor;
    fc.adjustedStart = anchor;
    fc.firstWordStart = anchor;
  }
}

function splitLongPhraseByDuration(spec, allWords, timeline, maxDurationSec) {
  const meta = timeline.slice(spec.tokenStart, spec.tokenEnd + 1);
  if (!meta.length || meta[meta.length - 1].end - meta[0].start <= maxDurationSec) {
    return [spec];
  }
  const parts = [];
  let chunkStart = 0;
  for (let i = 0; i < meta.length; i++) {
    const span = meta[i].end - meta[chunkStart].start;
    const atEnd = i === meta.length - 1;
    const gap = i < meta.length - 1 ? meta[i + 1].start - meta[i].end : 0;
    const boundary =
      atEnd ||
      span >= maxDurationSec ||
      (gap >= silenceGapThresholdSec(3) && i - chunkStart >= 1);
    if (!boundary) continue;
    const absStart = spec.tokenStart + chunkStart;
    const absEnd = spec.tokenStart + i;
    parts.push({
      text: allWords.slice(absStart, absEnd + 1).join(' '),
      tokenStart: absStart,
      tokenEnd: absEnd,
      boundaryReason: 'max_duration'
    });
    chunkStart = i + 1;
  }
  return parts.length ? parts : [spec];
}

function composeRhythmBlocks(rawSegments, opts = {}) {
  const minDurationSec = Math.max(0.4, Number(opts.minDurationSec ?? 0.7));
  const maxDurationSec = Math.max(minDurationSec, Number(opts.maxDurationSec ?? 2.6));
  const collapsed = collapseProgressiveTranslatedSegments(Array.isArray(rawSegments) ? rawSegments : []);
  const { segments, offsetSec: whisperLeadingOffsetSec } = applyWhisperLeadingOffsetIfNeeded(
    collapsed,
    { firstSpeechSec: opts.firstSpeechSec }
  );
  if (whisperLeadingOffsetSec > 0) {
    console.log('[phrase-whisper-leading-offset]', {
      offsetSec: whisperLeadingOffsetSec,
      firstStartAfter: segments[0]?.start
    });
  }
  const blocks = [];
  let isFirstExportCue = true;

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const seg = segments[segIndex];
    const segmentText = normalizeCueText(seg.text || '');
    if (!segmentText) continue;

    const { sourceSegmentId, translatedSegmentId } = resolveSegmentIds(seg, segIndex);
    const tokenTimeline = buildSegmentTextOrderedTimeline(seg);
    const allWords = cueWords(segmentText);
    let phraseSpecs = splitSegmentTextIntoPhrases(segmentText, opts);

    const expandedSpecs = [];
    for (const spec of phraseSpecs) {
      const sub = splitLongPhraseByDuration(spec, allWords, tokenTimeline, maxDurationSec);
      for (const s of sub) {
        if (phraseVisualLineCount(s.text) > 1) {
          expandedSpecs.push(...subdividePhraseSpec(s, allWords));
        } else {
          expandedSpecs.push(s);
        }
      }
    }
    phraseSpecs = expandedSpecs;

    for (const spec of phraseSpecs) {
      const text = normalizeCueText(spec.text);
      if (!text) continue;
      const chunkMeta = tokenTimeline.slice(spec.tokenStart, spec.tokenEnd + 1);
      const firstWordAt = Number(chunkMeta[0]?.start ?? seg.start);
      const forceZero =
        isFirstExportCue &&
        (Number(seg.start) <= 0.2 || firstWordAt <= 0.2) &&
        firstWordAt <= 0.35;

      const baseBlock = {
        text,
        words: cueWords(text),
        wordTimeline: chunkMeta,
        boundaryReason: spec.boundaryReason ?? null,
        sourceSegmentId,
        translatedSegmentId,
        segmentIndex: segIndex,
        segmentStart: Number(seg.start),
        segmentEnd: Number(seg.end)
      };

      if (!chunkMeta.length) {
        const segStart = Number(seg.start);
        const segEnd = Number(seg.end);
        blocks.push({
          ...baseBlock,
          start: forceZero ? 0 : segStart,
          end: segEnd,
          adjustedStart: forceZero ? 0 : segStart,
          adjustedEnd: segEnd,
          firstWordStart: forceZero ? 0 : segStart,
          lastWordEnd: segEnd,
          speechRate: 3
        });
      } else {
        blocks.push(reanchorBlockTiming(baseBlock, { forceStartAtZero: forceZero }));
      }
      isFirstExportCue = false;
    }
  }

  const smoothed = [];
  for (const block of blocks) {
    const cur = reanchorBlockTiming({ ...block });
    const prev = smoothed[smoothed.length - 1];
    if (prev && cur.end - cur.start < minDurationSec) {
      const extendedEnd = Math.max(prev.end, cur.start - SYNC_OVERLAP_GAP_SEC);
      if (extendedEnd > prev.start + 0.08) {
        prev.end = extendedEnd;
        prev.adjustedEnd = prev.end;
      }
    }
    smoothed.push(cur);
  }

  eliminateCaptionOverlaps(smoothed, SYNC_OVERLAP_GAP_SEC);
  applySpeechRatePersistence(smoothed);
  eliminateCaptionOverlaps(smoothed, SYNC_OVERLAP_GAP_SEC);
  clampFirstPhraseCueTiming(smoothed, segments[0]);

  if (smoothed.length) {
    const fc = smoothed[0];
    const shouldSnapFirstCueToZero =
      whisperLeadingOffsetSec > 0 ||
      Number(segments[0]?.start) <= 0.15 ||
      Number(fc.start) <= 0.2;
    if (shouldSnapFirstCueToZero) {
      fc.start = 0;
      fc.adjustedStart = 0;
      fc.firstWordStart = 0;
    }
  }

  if (isPhraseTimingForensicCaptureActive()) {
    for (let i = 0; i < smoothed.length; i++) {
      const b = smoothed[i];
      const trace = b._phraseTimingTrace || {};
      _phraseTimingComposeForensicRows.push({
        phraseIndex: i,
        phraseText: normalizeCueText(b.text),
        sourceSegmentId: b.sourceSegmentId ?? null,
        translatedSegmentId: b.translatedSegmentId ?? null,
        firstWordStart: Number(b.firstWordStart ?? trace.firstWordStart ?? null),
        speechAnchorStart: Number(trace.speechAnchorStart ?? b.firstWordStart ?? null),
        phraseStartBeforeReanchor: Number(trace.phraseStartBeforeReanchor ?? b.firstWordStart ?? null),
        phraseStartAfterReanchor: Number(trace.phraseStartAfterReanchor ?? b.start ?? null),
        prerollSec: trace.prerollSec ?? null,
        phraseStartAfterDetectAndCorrectDrift: Number(b.start),
        driftCorrectionApplied: b.driftCorrectionApplied ?? 0,
        afterComposeRhythmBlocksStart: Number(b.start),
        afterComposeRhythmBlocksEnd: Number(b.end)
      });
    }
  }

  const out = smoothed.map((b, i) => ({
    id: `cue_${i}`,
    index: i,
    start: Number(b.start),
    end: Number(b.end),
    duration: Number((b.end - b.start).toFixed(3)),
    text: normalizeCueText(b.text),
    words: b.words,
    emphasisWords: detectEmphasisWords(b.text),
    firstWordStart: Number(b.firstWordStart ?? b.start),
    lastWordEnd: Number(b.lastWordEnd ?? b.end),
    adjustedStart: Number(b.adjustedStart ?? b.start),
    adjustedEnd: Number(b.adjustedEnd ?? b.end),
    speechRate: Number((b.speechRate || 0).toFixed(3)),
    wordTimeline: b.wordTimeline,
    boundaryReason: b.boundaryReason ?? null,
    boundaryGap: b.boundaryGap ?? null,
    driftCorrectionApplied: b.driftCorrectionApplied ?? 0,
    sourceSegmentId: b.sourceSegmentId ?? null,
    translatedSegmentId: b.translatedSegmentId ?? null,
    segmentIndex: Number.isFinite(Number(b.segmentIndex)) ? Number(b.segmentIndex) : null,
    _words: b.words
  }));
  logCaptionSyncDebug(out);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (!prev.emphasisWords?.length || !cur.emphasisWords?.length) continue;
    cur.emphasisWords = cur.emphasisWords.filter((w) => !prev.emphasisWords.includes(w)).slice(0, 2);
  }
  console.log(
    '[word-timing-debug]',
    out.map((c) => ({
      words: c.words,
      sourceSegmentId: c.sourceSegmentId,
      translatedSegmentId: c.translatedSegmentId,
      firstWordStart: c.firstWordStart,
      lastWordEnd: c.lastWordEnd,
      adjustedStart: c.adjustedStart,
      adjustedEnd: c.adjustedEnd,
      speechRate: c.speechRate,
      chunkWordCount: Array.isArray(c.words) ? c.words.length : 0
    }))
  );
  return out;
}

function cloneCue(cue) {
  return {
    id: cue.id,
    index: cue.index,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    words: cue.words,
    duration: cue.duration,
    emphasisWords: cue.emphasisWords,
    sourceSegmentId: cue.sourceSegmentId ?? null,
    translatedSegmentId: cue.translatedSegmentId ?? null,
    segmentIndex: cue.segmentIndex ?? null,
    previewLines: cue.previewLines ?? null
  };
}

function longestGapSec(cues) {
  if (!Array.isArray(cues) || cues.length <= 1) return 0;
  let maxGap = 0;
  for (let i = 1; i < cues.length; i++) {
    const gap = Math.max(0, Number(cues[i].start) - Number(cues[i - 1].end));
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

function copyWithoutPrivate(cues) {
  return cues.map((cue) => ({
    id: cue.id,
    index: cue.index,
    start: cue.start,
    end: cue.end,
    text: cue.text
  }));
}

/** Min libass frame visibility (~4 frames @ 30fps). */
export const MIN_BURN_CUE_VISIBLE_SEC = 0.13;

/** Min on-screen time for a readable phrase on export. */
export const MIN_BURN_PHRASE_READ_SEC = Number(process.env.RENDER_BURN_MIN_READ_SEC || 0.72);

/** Hold after last word so subs do not vanish before speech ends. */
export const BURN_TAIL_PAD_SEC = Number(process.env.RENDER_BURN_TAIL_PAD_SEC || 0.2);

/** Slight delay before each phrase appears (reduces "next line too early"). */
export const BURN_LEAD_DELAY_SEC = Number(process.env.RENDER_BURN_LEAD_DELAY_SEC || 0.09);

const ROLLING_CHAIN_GAP_SEC = 0.18;

/**
 * Merge YouTube rolling captions into one phrase per utterance (first start → last end).
 */
export function mergeRollingCaptionChains(segments) {
  const sorted = [...(Array.isArray(segments) ? segments : [])]
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const chains = [];
  let chain = null;

  const flush = () => {
    if (!chain) return;
    const text = normalizeCueText(chain.text);
    if (!text) {
      chain = null;
      return;
    }
    chains.push({
      start: chain.start,
      end: chain.end,
      text,
      words: cueWords(text)
    });
    chain = null;
  };

  for (const seg of sorted) {
    const text = normalizeCueText(seg.text);
    if (!text) continue;
    const start = Number(seg.start);
    const end = Number(seg.end);

    if (!chain) {
      chain = { start, end, text };
      continue;
    }

    const gap = start - chain.end;
    const prev = chain.text;
    const growing = text.startsWith(prev) && text.length > prev.length;
    const same = text === prev;

    if (gap <= ROLLING_CHAIN_GAP_SEC && (growing || same)) {
      chain.end = Math.max(chain.end, end);
      if (text.length > prev.length) chain.text = text;
      continue;
    }

    if (chain && gap > ROLLING_CHAIN_GAP_SEC && gap < 1.2) {
      chain.end = Math.max(chain.end, start - 0.03);
    }
    flush();
    chain = { start, end, text };
  }
  flush();
  return chains;
}

/**
 * Drop blink-length orphans; glue tiny tail words into the next phrase.
 */
export function coalesceBurnPhrases(cues, opts = {}) {
  const preservePhraseCues = Boolean(opts.preservePhraseCues);
  const sorted = [...(Array.isArray(cues) ? cues : [])].sort((a, b) => a.start - b.start);
  if (preservePhraseCues) {
    return sorted
      .map((cur) => {
        const text = normalizeCueText(cur.text);
        if (!text) return null;
        return { start: cur.start, end: cur.end, text, words: cueWords(text) };
      })
      .filter(Boolean);
  }
  const out = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const dur = cur.end - cur.start;
    const text = normalizeCueText(cur.text);
    if (!text) continue;

    if (
      next &&
      dur < 0.4 &&
      next.start - cur.start < 0.35 &&
      next.text.length > text.length
    ) {
      continue;
    }

    const prev = out[out.length - 1];
    if (prev && cur.start - prev.end < 0.14 && dur < 0.55) {
      prev.text = normalizeCueText(`${prev.text} ${text}`);
      prev.words = cueWords(prev.text);
      prev.end = Math.max(prev.end, cur.end);
      continue;
    }

    out.push({ start: cur.start, end: cur.end, text, words: cueWords(text) });
  }
  return out;
}

/** @deprecated use mergeRollingCaptionChains */
export function collapseRollingCaptionCues(segments) {
  return mergeRollingCaptionChains(segments);
}

/**
 * Keep natural speech end times; only extend short cues (never chop to a blink).
 */
export function stabilizeBurnCueTiming(cues, opts = {}) {
  const minVisibleSec = Math.max(0.08, Number(opts.minVisibleSec ?? MIN_BURN_CUE_VISIBLE_SEC));
  const minReadSec = Math.max(minVisibleSec, Number(opts.minReadSec ?? MIN_BURN_PHRASE_READ_SEC));
  const tailPadSec = Math.max(0, Number(opts.tailPadSec ?? BURN_TAIL_PAD_SEC));
  const leadDelaySec = Math.max(0, Number(opts.leadDelaySec ?? BURN_LEAD_DELAY_SEC));
  const interCueGapSec = Math.max(0.01, Number(opts.interCueGapSec ?? 0.02));

  const sorted = [...(Array.isArray(cues) ? cues : [])].sort((a, b) => a.start - b.start);

  return sorted.map((cue, i) => {
    const next = sorted[i + 1];
    const rawStart = Number(cue.start);
    const naturalEnd = Number(cue.end);
    const start = rawStart + leadDelaySec;
    const text = normalizeCueText(cue.text);
    const wordCount = cueWords(text).length;
    const minByWords = Math.min(5.5, Math.max(minReadSec, wordCount * 0.22));

    let end = naturalEnd + tailPadSec;
    end = Math.max(end, start + minByWords, start + minVisibleSec);

    if (next) {
      const nextStart = Number(next.start) + leadDelaySec;
      const pauseGap = nextStart - (naturalEnd + tailPadSec);
      if (pauseGap > 0.12) {
        end = Math.min(naturalEnd + tailPadSec + pauseGap * 0.4, nextStart - interCueGapSec);
      } else if (end > nextStart - interCueGapSec) {
        end = Math.max(naturalEnd + tailPadSec * 0.5, nextStart - interCueGapSec);
      }
    }

    end = Math.max(start + minVisibleSec, end);

    return {
      ...cue,
      text,
      words: cueWords(text),
      start,
      end,
      sourceStart: start,
      sourceEnd: end,
      duration: Number((end - start).toFixed(3))
    };
  });
}

/** @deprecated use stabilizeBurnCueTiming */
export function ensureBurnCueDurations(cues, minDurSec = MIN_BURN_CUE_VISIBLE_SEC) {
  return stabilizeBurnCueTiming(cues, { minVisibleSec: minDurSec, minReadSec: minDurSec });
}

/** YouTube rolling captions often include 0.01s blink cues — skip for ASS burn. */
export const PREVIEW_EXPORT_MIN_CUE_SEC = 0.08;

const BURN_STRIP_TAG_RE = /\[[^\]]*\]\s*/gi;

/** Remove [music] and similar tags from burned viral captions (not SRT download). */
export function stripBurnNonSpeechTags(text) {
  return normalizeCueText(String(text || '').replace(BURN_STRIP_TAG_RE, ' '));
}

/**
 * Clean SRT → burn-ready: merge rolling chains, strip tags, keep first sentence visible.
 */
export function prepareCleanSrtBurnCues(rawSegments) {
  const parsed = (Array.isArray(rawSegments) ? rawSegments : [])
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start)
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: stripBurnNonSpeechTags(s.text)
    }))
    .filter((s) => s.text);

  const merged = mergeRollingCaptionChains(parsed);
  return [...merged].sort((a, b) => a.start - b.start);
}

function shiftCueTimeline(cues, offsetSec) {
  const offset = Number(offsetSec);
  if (!Number.isFinite(offset) || Math.abs(offset) < 0.05) {
    return { cues: Array.isArray(cues) ? cues : [], offsetSec: 0 };
  }
  const shifted = (Array.isArray(cues) ? cues : []).map((cue) => {
    const start = Math.max(0, Number(cue.start) - offset);
    const end = Math.max(start + 0.05, Number(cue.end) - offset);
    return {
      ...cue,
      start,
      end,
      sourceStart: start,
      sourceEnd: end,
      duration: Number((end - start).toFixed(3))
    };
  });
  return { cues: shifted, offsetSec: offset };
}

/**
 * Align first clean-SRT cue to detected speech in the video file (keeps SRT spacing).
 */
export function alignCleanSrtToVideoSpeech(cues, firstSpeechSec) {
  const sorted = [...(Array.isArray(cues) ? cues : [])].sort((a, b) => a.start - b.start);
  if (!sorted.length) return { cues: sorted, offsetSec: 0 };
  const firstStart = Number(sorted[0].start);
  const speech = Number(firstSpeechSec);
  if (!Number.isFinite(speech) || speech < 0 || speech > 2.5) {
    return { cues: sorted, offsetSec: 0 };
  }
  const offset = firstStart - speech;
  if (Math.abs(offset) < 0.05 || Math.abs(offset) > 3.2) {
    return { cues: sorted, offsetSec: 0 };
  }
  return shiftCueTimeline(sorted, offset);
}

/**
 * Pick burn timeline alignment: speech anchor when known, else snap to t=0.
 */
export function alignCleanSrtForBurn(cues, firstSpeechSec) {
  const speech = Number(firstSpeechSec);
  if (Number.isFinite(speech) && speech >= 0 && speech <= 2.5) {
    return alignCleanSrtToVideoSpeech(cues, speech);
  }
  return snapCleanSrtTimelineToZero(cues);
}

/**
 * Shift clean-SRT timeline so earliest cue starts at t≈0 (uniform offset, text unchanged).
 */
export function snapCleanSrtTimelineToZero(cues) {
  const list = Array.isArray(cues) ? cues : [];
  if (!list.length) return { cues: list, offsetSec: 0 };
  const lead = Math.min(...list.map((c) => Number(c.start)).filter(Number.isFinite));
  if (!Number.isFinite(lead) || lead < 0.45 || lead > 2.8) {
    return { cues: list, offsetSec: 0 };
  }
  return shiftCueTimeline(list, lead);
}

/** @deprecated use snapCleanSrtTimelineToZero */
export function snapPreviewExportTimelineToZero(cues) {
  return snapCleanSrtTimelineToZero(cues).cues;
}

/**
 * Export burn: 1:1 clean SRT cues (no merge, no timeline shift). Text tags stripped only.
 */
export function buildCleanSrtExactSubtitles(rawSegments) {
  const cues = (Array.isArray(rawSegments) ? rawSegments : [])
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start)
    .map((seg, i) => {
      const text = stripBurnNonSpeechTags(seg.text);
      if (!text) return null;
      const start = Number(seg.start);
      const end = Number(seg.end);
      const previewLines =
        Array.isArray(seg.previewLines) && seg.previewLines.length === 1
          ? seg.previewLines.map((l) => String(l))
          : null;
      return {
        id: `srt-${i}`,
        index: i,
        start,
        end,
        duration: Number((end - start).toFixed(3)),
        text,
        words: cueWords(text),
        sourceStart: start,
        sourceEnd: end,
        previewLines
      };
    })
    .filter(Boolean);

  console.log('[clean-srt-exact-burn]', {
    cueCount: cues.length,
    firstCue: cues[0]
      ? { start: cues[0].start, end: cues[0].end, text: String(cues[0].text).slice(0, 80) }
      : null
  });
  return cues;
}

/**
 * Whisper often tags the first word ~1–2s late. Extend only cue 0's display window backward
 * (source timings unchanged for sync checks; renderStart/renderEnd only).
 */
export function applyCleanSrtFirstCueLeadIn(cues, opts = {}) {
  const list = (Array.isArray(cues) ? cues : []).map((c) => ({ ...c }));
  if (!list.length) return list;

  const fillThroughSec = Number(opts.fillThroughSec ?? 2);
  const maxLateStartSec = Number(opts.maxLateStartSec ?? 2.8);
  const minVisibleSec = Number(opts.minVisibleSec ?? 4 / 30 + 0.002);

  const first = list[0];
  const sourceStart = Number(first.sourceStart ?? first.start);
  let renderStart = Number(first.renderStart ?? sourceStart);
  let renderEnd = Number(first.renderEnd ?? first.sourceEnd ?? first.end);

  if (!Number.isFinite(sourceStart) || sourceStart <= 0.05 || sourceStart > maxLateStartSec) {
    return list;
  }

  const next = list[1];
  const nextStart = next ? Number(next.sourceStart ?? next.start) : null;

  renderStart = 0;
  renderEnd = Math.max(renderEnd, fillThroughSec);
  if (nextStart != null && nextStart > renderStart) {
    renderEnd = Math.min(renderEnd, nextStart - 0.001);
  }
  if (renderEnd - renderStart < minVisibleSec) {
    renderEnd = Math.max(renderEnd, renderStart + minVisibleSec);
    if (nextStart != null) renderEnd = Math.min(renderEnd, nextStart - 0.001);
  }

  list[0] = { ...first, renderStart, renderEnd };
  console.log('[clean-srt-first-lead-in]', {
    sourceStart,
    renderStart,
    renderEnd,
    nextStart
  });
  return list;
}

/**
 * Split long SRT cues into shorter on-screen chunks (render times only; source SRT unchanged).
 */
export function expandCueVisualChunks(cues, opts = {}) {
  const isVertical = Boolean(opts.isVertical);
  const maxWordsPerChunk = Math.max(2, Number(opts.maxWordsPerChunk ?? (isVertical ? 4 : 5)));
  const minWordsToSplit = Math.max(
    3,
    Number(opts.minWordsToSplit ?? (isVertical ? 4 : maxWordsPerChunk + 1))
  );
  const minChunkSec = Math.max(0.28, Number(opts.minChunkSec ?? 0.38));
  const minDurToSplitSec = Math.max(
    isVertical ? 0.35 : 2,
    Number(opts.minDurToSplitSec ?? (isVertical ? 0.5 : 2.2))
  );
  const gapSec = Math.max(0.01, Number(opts.gapSec ?? 0.02));
  const maxCharsPerChunk = Math.max(0, Number(opts.maxCharsPerChunk ?? 0));
  const forceSplitOverflow = Boolean(opts.forceSplitOverflow);

  const out = [];
  for (const cue of Array.isArray(cues) ? cues : []) {
    const text = stripBurnNonSpeechTags(cue.text);
    if (!text) continue;

    if (isRtlText(text)) {
      out.push({ ...cue, text, previewLines: null });
      continue;
    }

    const w = cueWords(text);
    const start = Number(cue.renderStart ?? cue.sourceStart ?? cue.start);
    const end = Number(cue.renderEnd ?? cue.sourceEnd ?? cue.end);
    const dur = end - start;

    const overflowSplit =
      forceSplitOverflow && maxCharsPerChunk > 0 && w.length >= 3 && text.length > maxCharsPerChunk;
    const shouldSplit =
      overflowSplit ||
      (w.length >= minWordsToSplit && dur >= minDurToSplitSec && start > 0.02);

    if (!shouldSplit) {
      out.push({ ...cue, text, previewLines: null });
      continue;
    }

    let wordChunks;
    if (overflowSplit && maxCharsPerChunk > 0) {
      wordChunks = splitWordsByCharBudget(w, maxCharsPerChunk);
    } else {
      const chunkCount = Math.ceil(w.length / maxWordsPerChunk);
      wordChunks = [];
      for (let i = 0; i < chunkCount; i++) {
        wordChunks.push(w.slice(i * maxWordsPerChunk, (i + 1) * maxWordsPerChunk));
      }
    }

    const sliceDur = dur / wordChunks.length;
    for (let i = 0; i < wordChunks.length; i++) {
      const chunkWords = wordChunks[i];
      if (!chunkWords?.length) continue;
      const chunkStart = start + i * sliceDur;
      const chunkEnd = i === wordChunks.length - 1 ? end : start + (i + 1) * sliceDur - gapSec;
      out.push({
        ...cue,
        id: `${cue.id || 'cue'}-v${i}`,
        text: chunkWords.join(' '),
        renderStart: Number(chunkStart.toFixed(3)),
        renderEnd: Math.max(chunkStart + minChunkSec, Number(chunkEnd.toFixed(3))),
        previewLines: null
      });
    }
  }

  if (out.length > (Array.isArray(cues) ? cues.length : 0)) {
    console.log('[clean-srt-visual-chunks]', {
      inputCues: cues.length,
      outputCues: out.length,
      maxWordsPerChunk
    });
  }
  return out.length ? out : cues;
}

/**
 * Burn/export from clean SRT: merge rolling utterances, strip [music], keep first line readable.
 */
export function buildPreviewAlignedSubtitles(rawSegments) {
  const prepared = prepareCleanSrtBurnCues(rawSegments);
  const cues = prepared.map((cue, i) => {
    const start = Number(cue.start);
    const end = Number(cue.end);
    const text = stripBurnNonSpeechTags(cue.text);
    return {
      id: `preview-${i}`,
      index: i,
      start,
      end,
      duration: Number((end - start).toFixed(3)),
      text,
      words: cueWords(text),
      sourceStart: start,
      sourceEnd: end,
      previewLines: null
    };
  });
  console.log('[preview-burn-clean-srt]', {
    cueCount: cues.length,
    firstCue: cues[0]
      ? { start: cues[0].start, end: cues[0].end, text: String(cues[0].text).slice(0, 80) }
      : null
  });
  return cues;
}

/**
 * Burn/export: preserve segment start/end (collapse rolling SRT + min visible duration).
 */
export function buildSourceAlignedSubtitles(rawSegments) {
  const raw = Array.isArray(rawSegments) ? rawSegments : [];
  const cues = [];
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) {
      continue;
    }
    const text = normalizeCueText(seg.text);
    if (!text) continue;
    const start = Number(seg.start);
    const end = Number(seg.end);
    const timedWords =
      Array.isArray(seg.words) &&
      seg.words.length &&
      seg.words.some((w) => w && Number.isFinite(Number(w.start)))
        ? seg.words
        : cueWords(text);
    cues.push({
      id: `src-${i}`,
      index: i,
      start,
      end,
      duration: Number((end - start).toFixed(3)),
      text,
      words: timedWords,
      sourceStart: start,
      sourceEnd: end
    });
  }
  const merged = mergeRollingCaptionChains(cues);
  const coalesced = coalesceBurnPhrases(merged);
  const stabilized = stabilizeBurnCueTiming(coalesced);
  if (raw.length !== stabilized.length) {
    console.log('[burn-caption-collapse]', {
      inputCues: raw.length,
      afterRollingMerge: merged.length,
      afterStabilize: stabilized.length,
      mergedChains: raw.length - merged.length,
      sample: stabilized.slice(0, 3).map((c) => ({
        start: c.start,
        end: c.end,
        dur: Number((c.end - c.start).toFixed(2)),
        text: String(c.text).slice(0, 50)
      }))
    });
  }
  return stabilized.map((cue, i) => ({
    id: `src-${i}`,
    index: i,
    ...cue
  }));
}

/**
 * Read-only pipeline audit (does not alter buildSourceAlignedSubtitles output).
 * Used by caption-forensics for per-stage timing evidence.
 */
export function auditSourceAlignedPipelineStages(rawSegments) {
  const raw = Array.isArray(rawSegments) ? rawSegments : [];
  const cues = [];
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) {
      continue;
    }
    const text = normalizeCueText(seg.text);
    if (!text) continue;
    const start = Number(seg.start);
    const end = Number(seg.end);
    cues.push({
      segmentIndex: i,
      start,
      end,
      text,
      sourceStart: start,
      sourceEnd: end
    });
  }
  const afterRollingMerge = mergeRollingCaptionChains(cues);
  const afterCoalesce = coalesceBurnPhrases(afterRollingMerge);
  const afterStabilize = stabilizeBurnCueTiming(afterCoalesce);

  const slice10 = (list) =>
    (Array.isArray(list) ? list : []).slice(0, 10).map((c, idx) => ({
      pipelineIndex: idx,
      segmentIndex: c.segmentIndex ?? null,
      start: Number(c.start),
      end: Number(c.end),
      text: String(c.text || '').slice(0, 120)
    }));

  return {
    inputCount: raw.length,
    parsedCount: cues.length,
    afterRollingMergeCount: afterRollingMerge.length,
    afterCoalesceCount: afterCoalesce.length,
    afterStabilizeCount: afterStabilize.length,
    parsed: slice10(cues),
    afterRollingMerge: slice10(afterRollingMerge),
    afterCoalesce: slice10(afterCoalesce),
    afterStabilize: slice10(afterStabilize)
  };
}

/**
 * Remove stacked "growing" captions (common with word-by-word ASR) before ASS burn-in.
 */
/**
 * Ensure only one burned cue is visible at a time (clip renderEnd before next renderStart).
 */
export function clipOverlappingCueRenderEnds(cues, opts = {}) {
  const gapSec = Math.max(0.01, Number(opts.gapSec ?? 0.02));
  const minVisibleSec = Math.max(0.05, Number(opts.minVisibleSec ?? 0.12));
  const sorted = [...(Array.isArray(cues) ? cues : [])].sort(
    (a, b) =>
      Number(a.renderStart ?? a.sourceStart ?? a.start) -
      Number(b.renderStart ?? b.sourceStart ?? b.start)
  );
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const curStart = Number(cur.renderStart ?? cur.sourceStart ?? cur.start);
    let curEnd = Number(cur.renderEnd ?? cur.sourceEnd ?? cur.end);
    const nextStart = Number(next.renderStart ?? next.sourceStart ?? next.start);
    if (!Number.isFinite(curStart) || !Number.isFinite(curEnd) || !Number.isFinite(nextStart)) {
      continue;
    }
    const capEnd = nextStart - gapSec;
    if (curEnd > capEnd) {
      curEnd = Math.max(curStart + minVisibleSec, capEnd);
      sorted[i] = { ...cur, renderEnd: Number(curEnd.toFixed(3)) };
    }
  }
  return sorted;
}

export function dedupeOverlappingBurnCues(cues) {
  const sorted = [...(Array.isArray(cues) ? cues : [])].sort((a, b) => a.start - b.start);
  const out = [];
  for (const cue of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...cue });
      continue;
    }
    const prevNorm = normalizeForAccumulation(prev.text);
    const curNorm = normalizeForAccumulation(cue.text);
    const overlaps = cue.start < prev.end + 0.08;
    const growing = curNorm.startsWith(prevNorm) && curNorm.length > prevNorm.length;
    const duplicate = prevNorm === curNorm && overlaps;
    if (overlaps && (growing || duplicate)) {
      out[out.length - 1] = {
        ...prev,
        text: growing ? cue.text : prev.text,
        end: Math.max(prev.end, cue.end),
        sourceEnd: Math.max(prev.sourceEnd ?? prev.end, cue.sourceEnd ?? cue.end),
        words: cueWords(growing ? cue.text : prev.text)
      };
      continue;
    }
    if (overlaps && prevNorm.startsWith(curNorm)) {
      continue;
    }
    out.push({ ...cue });
  }
  return out;
}

/**
 * Phrase-level burn/export captions (composeRhythmBlocks). One short phrase per cue.
 */
export function buildPhraseBurnSubtitles(rawSegments) {
  return buildCanonicalSubtitles(rawSegments);
}

/**
 * Immutable source-of-truth subtitle layer.
 * Never rewrites transcript semantics.
 */
export function buildCanonicalSubtitles(rawSegments) {
  const raw = Array.isArray(rawSegments) ? rawSegments : [];
  const composed = composeRhythmBlocks(raw, {
    maxWordsPerBlock: 5,
    minDurationSec: 0.7,
    maxDurationSec: 2.6,
    overlapGuardSec: SYNC_OVERLAP_GAP_SEC,
    lowConfidenceThreshold: Number(process.env.ASR_LOW_CONF_THRESHOLD || 0.62),
    enableModelVoting: String(process.env.ASR_ENABLE_MODEL_VOTING || '0') === '1',
    languageHint: String(process.env.ASR_LANGUAGE_HINT || 'auto')
  });
  return validateAndFixCaptionTimingForExport(composed);
}

/**
 * Visual-only layer. Keeps cue text + timing unchanged.
 */
export function buildVisualCueView(canonicalSubtitles, mode = CAPTION_QUALITY_MODES.VIRAL) {
  const m = String(mode || CAPTION_QUALITY_MODES.VIRAL).toLowerCase();
  return canonicalSubtitles.map((cue) => ({
    ...cloneCue(cue),
    sourceStart: cue.start,
    sourceEnd: cue.end,
    renderStart: cue.start,
    renderEnd: cue.end,
    visualMode: m
  }));
}

/**
 * Extend ultra-short cues for readability without mutating source timing.
 * Source timing remains available in sourceStart/sourceEnd.
 */
export function applyVisualReadabilityWindows(visualCues, opts = {}) {
  const minCueDurationSec = Math.max(0.08, Number(opts.minCueDurationSec ?? 0.85));
  const minGapSec = Math.max(0, Number(opts.minGapSec ?? 0.03));
  const maxOverlapSec = Math.max(0, Number(opts.maxOverlapSec ?? 0.08));
  const maxTailExtensionSec = Math.max(0, Number(opts.maxTailExtensionSec ?? 0.55));
  const maxLeadExtensionSec = Math.max(0, Number(opts.maxLeadExtensionSec ?? 0.18));
  const videoDurationSec = Number(opts.videoDurationSec || 0);

  const cues = (Array.isArray(visualCues) ? visualCues : []).map((cue) => ({ ...cue }));
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    cue.renderStart = Number(cue.renderStart ?? cue.start ?? cue.sourceStart);
    cue.renderEnd = Number(cue.renderEnd ?? cue.end ?? cue.sourceEnd);
    cue.sourceStart = Number(cue.sourceStart ?? cue.start);
    cue.sourceEnd = Number(cue.sourceEnd ?? cue.end);

    if (i === 0) {
      const fw = Number(cue.firstWordStart ?? cue.start);
      if (fw <= 0.25) {
        cue.sourceStart = 0;
        cue.renderStart = 0;
        cue.start = 0;
      }
    }

    const minEndByFrame = cue.renderStart + Math.max(0.04, minCueDurationSec);
    if (cue.renderEnd < minEndByFrame) cue.renderEnd = minEndByFrame;

    const next = cues[i + 1];
    if (next) {
      const nextStart = Number(next.sourceStart ?? next.start);
      const hardEnd = Math.max(cue.renderStart + 0.04, nextStart + maxOverlapSec);
      const allowedEnd = Math.min(hardEnd, cue.sourceEnd + maxTailExtensionSec);
      cue.renderEnd = Math.min(cue.renderEnd, allowedEnd);
    } else if (videoDurationSec > 0) {
      cue.renderEnd = Math.min(cue.renderEnd, videoDurationSec - minGapSec);
    }

    const sourceDur = Math.max(0.04, cue.sourceEnd - cue.sourceStart);
    const currentDur = Math.max(0.04, cue.renderEnd - cue.renderStart);
    if (currentDur + 1e-6 < minCueDurationSec) {
      const missing = minCueDurationSec - currentDur;
      const prev = cues[i - 1];
      const leadLimit = prev
        ? Math.max(Number(prev.renderEnd || prev.sourceEnd) + minGapSec, cue.sourceStart - maxLeadExtensionSec)
        : Math.max(0, cue.sourceStart - maxLeadExtensionSec);
      const newStart = Math.max(leadLimit, cue.renderStart - missing);
      cue.renderStart = Math.min(cue.sourceStart, newStart);
    }

    // Keep render window at least source duration unless adjacent cue constraints block it.
    cue.renderEnd = Math.max(cue.renderEnd, cue.renderStart + Math.min(sourceDur, minCueDurationSec));
  }
  return cues;
}

export function validateVisualVisibility(visualCues, opts = {}) {
  const fps = Math.max(1, Number(opts.fps ?? 30));
  const minFrames = Math.max(2, Number(opts.minFrames ?? 4));
  const minVisibleSec = Math.max(1 / fps, minFrames / fps);
  const warnings = [];
  let invisibleCount = 0;
  let microCueCount = 0;

  const cues = Array.isArray(visualCues) ? visualCues : [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const dur = Math.max(0, Number(cue.renderEnd) - Number(cue.renderStart));
    if (dur <= 1 / fps) {
      invisibleCount += 1;
      warnings.push(`invisible_frame_${i}`);
      continue;
    }
    if (dur < minVisibleSec) {
      microCueCount += 1;
      warnings.push(`micro_flash_${i}`);
    }
  }

  return {
    ok: invisibleCount === 0,
    warnings,
    minVisibleSec: Number(minVisibleSec.toFixed(3)),
    invisibleCount,
    microCueCount
  };
}

export function validateVisualContinuity(canonicalSubtitles, visualCues, opts = {}) {
  const base = analyzeCueIntegrity(canonicalSubtitles, visualCues, {
    maxTimingDriftMs: Number(opts.maxTimingDriftMs ?? 260),
    maxExtraGapSec: Number(opts.maxExtraGapSec ?? 0.5)
  });
  const warnings = [];
  const maxGapGrowthSec = Math.max(0, Number(opts.maxGapGrowthSec ?? 0.35));
  const canonical = Array.isArray(canonicalSubtitles) ? canonicalSubtitles : [];
  const cues = Array.isArray(visualCues) ? visualCues : [];
  for (let i = 1; i < cues.length; i++) {
    const sourceGap = Math.max(0, Number(canonical[i]?.sourceStart ?? canonical[i]?.start) - Number(canonical[i - 1]?.sourceEnd ?? canonical[i - 1]?.end));
    const visualGap = Math.max(0, Number(cues[i].renderStart) - Number(cues[i - 1].renderEnd));
    const growth = visualGap - sourceGap;
    if (growth > maxGapGrowthSec) warnings.push(`gap_growth_at_${i}:${growth.toFixed(3)}s`);
  }
  return {
    ...base,
    warnings,
    ok: base.ok && warnings.length === 0
  };
}

export function subtitleDensityMetrics(cues, durationSec = 0) {
  const list = Array.isArray(cues) ? cues : [];
  const cueCount = list.length;
  const wordCount = list.reduce((sum, cue) => sum + cueWords(cue.text).length, 0);
  const dur = Math.max(0.001, Number(durationSec || 0) || 0.001);
  const wordsPerSec = wordCount / dur;
  const cuesPerSec = cueCount / dur;
  return {
    cueCount,
    wordCount,
    wordsPerSec: Number(wordsPerSec.toFixed(3)),
    cuesPerSec: Number(cuesPerSec.toFixed(3))
  };
}

export function readabilityScore(metrics, continuity, visibility) {
  const densityPenalty = Math.min(0.45, Math.max(0, (metrics.wordsPerSec - 3.4) * 0.09));
  const continuityPenalty = Math.min(0.3, Math.max(0, (continuity.longestGapSec - 0.9) * 0.12));
  const flashPenalty = Math.min(0.35, (visibility.microCueCount || 0) * 0.03 + (visibility.invisibleCount || 0) * 0.12);
  const score = 1 - densityPenalty - continuityPenalty - flashPenalty;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

export function analyzeCueIntegrity(canonicalSubtitles, styledSubtitles, opts = {}) {
  const maxTimingDriftMs = Math.max(0, Number(opts.maxTimingDriftMs ?? 1));
  const maxExtraGapSec = Math.max(0, Number(opts.maxExtraGapSec ?? 0.2));
  const issues = [];
  const canonical = Array.isArray(canonicalSubtitles) ? canonicalSubtitles : [];
  const styled = Array.isArray(styledSubtitles) ? styledSubtitles : [];

  if (canonical.length !== styled.length) {
    issues.push(`cue_count_mismatch:${canonical.length}->${styled.length}`);
  }

  let canonicalWordCount = 0;
  let styledWordCount = 0;
  const pairCount = Math.min(canonical.length, styled.length);

  for (let i = 0; i < pairCount; i++) {
    const src = canonical[i];
    const dst = styled[i];
    const srcWords = src?._words || cueWords(src?.text || '');
    const dstWords = cueWords(dst?.text || '');
    canonicalWordCount += srcWords.length;
    styledWordCount += dstWords.length;

    const startDriftMs = Math.abs((Number(dst.start) - Number(src.start)) * 1000);
    const endDriftMs = Math.abs((Number(dst.end) - Number(src.end)) * 1000);
    if (startDriftMs > maxTimingDriftMs || endDriftMs > maxTimingDriftMs) {
      issues.push(`timing_drift_at_${i}`);
    }

    if (src.text !== dst.text) {
      issues.push(`text_changed_at_${i}`);
    }
  }

  const canonicalGap = longestGapSec(canonical);
  const styledGap = longestGapSec(styled);
  const extraGapSec = styledGap - canonicalGap;
  if (extraGapSec > maxExtraGapSec) {
    issues.push(`gap_growth:${extraGapSec.toFixed(3)}s`);
  }

  if (styledWordCount < canonicalWordCount) {
    issues.push(`dropped_words:${canonicalWordCount - styledWordCount}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    canonicalCueCount: canonical.length,
    styledCueCount: styled.length,
    canonicalWordCount,
    styledWordCount,
    canonicalLongestGapSec: Number(canonicalGap.toFixed(3)),
    styledLongestGapSec: Number(styledGap.toFixed(3)),
    extraGapSec: Number(extraGapSec.toFixed(3))
  };
}

export function assertCueIntegrity(canonicalSubtitles, styledSubtitles, opts = {}) {
  const report = analyzeCueIntegrity(canonicalSubtitles, styledSubtitles, opts);
  if (!report.ok) {
    const err = new Error(`SUBTITLE_INTEGRITY_LOSS: ${report.issues.join(',')}`);
    err.code = 'SUBTITLE_INTEGRITY_LOSS';
    err.report = report;
    throw err;
  }
  return report;
}

export function continuitySummary(subtitles) {
  const cues = Array.isArray(subtitles) ? subtitles : [];
  if (!cues.length) {
    return {
      cueCount: 0,
      longestGapSec: 0,
      oneWordCueCount: 0,
      oneWordCueRatio: 0
    };
  }
  const oneWordCueCount = cues.reduce((acc, cue) => (cueWords(cue.text).length <= 1 ? acc + 1 : acc), 0);
  const longestGap = longestGapSec(cues);
  return {
    cueCount: cues.length,
    longestGapSec: Number(longestGap.toFixed(3)),
    oneWordCueCount,
    oneWordCueRatio: Number((oneWordCueCount / cues.length).toFixed(3))
  };
}

/** Legacy export names (now immutable and source-of-truth preserving). */
export function prepareAccurateSegments(rawSegments) {
  return copyWithoutPrivate(buildCanonicalSubtitles(rawSegments));
}

/** Legacy export names (now immutable and source-of-truth preserving). */
export function prepareCleanSegments(rawSegments) {
  return copyWithoutPrivate(buildCanonicalSubtitles(rawSegments));
}

/** Legacy export names (now immutable and source-of-truth preserving). */
export function prepareCreatorSegments(rawSegments) {
  return copyWithoutPrivate(buildCanonicalSubtitles(rawSegments));
}

/**
 * @param {'accurate'|'clean'|'viral'} mode
 */
export function prepareSegmentsForMode(rawSegments, mode = 'viral') {
  const canonical = buildCanonicalSubtitles(rawSegments);
  const styled = buildVisualCueView(canonical, mode);
  assertCueIntegrity(canonical, styled);
  return styled.map((cue) => ({
    start: cue.start,
    end: cue.end,
    text: cue.text
  }));
}
