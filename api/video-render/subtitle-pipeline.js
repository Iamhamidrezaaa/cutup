/**
 * Subtitle pipeline with strict source-of-truth preservation.
 * Styling layers must never mutate transcript semantics.
 */
import { decodeSubtitleTextEntities } from '../subtitle-text-entities.js';

export const CAPTION_QUALITY_MODES = Object.freeze({
  ACCURATE: 'accurate',
  CLEAN: 'clean',
  VIRAL: 'viral'
});

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

function reanchorBlockTiming(block) {
  const meta = block.wordTimeline || [];
  if (!meta.length) return block;
  const firstWordStart = speechAnchorStart(meta);
  const lastWordEnd = speechAnchorEnd(meta);
  const speechRate = wordsPerSecond(meta.length, lastWordEnd - firstWordStart);
  const pad = adaptivePaddingFromSpeechRate(speechRate);
  return {
    ...block,
    firstWordStart,
    lastWordEnd,
    speechRate,
    adjustedStart: Math.max(0, firstWordStart - pad.preroll),
    adjustedEnd: lastWordEnd + pad.tail,
    start: Math.max(0, firstWordStart - pad.preroll),
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
      b.start = Math.max(0, b.start + correction);
      b.end = Math.max(b.start + 0.08, b.end + correction);
      b.adjustedStart = b.start;
      b.adjustedEnd = b.end;
      b.driftCorrectionApplied = Number(correction.toFixed(4));
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

  if (report.fixed.length || report.warnings.length) {
    console.log('[caption-sync-validation]', report);
  }
  return list;
}

function composeRhythmBlocks(rawSegments, opts = {}) {
  const baseMaxWords = Math.max(3, Math.min(5, Number(opts.maxWordsPerBlock ?? 5)));
  const minDurationSec = Math.max(0.4, Number(opts.minDurationSec ?? 0.7));
  const maxDurationSec = Math.max(minDurationSec, Number(opts.maxDurationSec ?? 2.6));
  const overlapGuardSec = Math.max(0, Number(opts.overlapGuardSec ?? SYNC_OVERLAP_GAP_SEC));
  const timelineResult = normalizeWordTimeline(rawSegments, opts);
  const timeline = timelineResult.words;
  const globalRate = globalSpeechRateWps(timeline);
  const blocks = [];
  let i = 0;
  while (i < timeline.length) {
    const chunkMeta = [timeline[i]];
    let j = i + 1;
    let boundaryReason = null;
    let boundaryGap = null;

    while (j < timeline.length) {
      const prev = chunkMeta[chunkMeta.length - 1];
      const next = timeline[j];
      const gap = next.start - prev.end;
      const localRate = wordsPerSecond(chunkMeta.length, prev.end - chunkMeta[0].start);
      const dynamicMaxWords = localRate > 3.8 ? 3 : localRate > 2.7 ? 4 : baseMaxWords;
      const decision = shouldForceCaptionBoundary(prev, next, gap, globalRate, chunkMeta.length, dynamicMaxWords);
      boundaryGap = gap;
      if (decision.break) {
        boundaryReason = decision.reason;
        break;
      }
      chunkMeta.push(next);
      if (/[.!?]$/.test(String(next.word)) && chunkMeta.length >= 2) {
        boundaryReason = 'punctuation';
        j += 1;
        break;
      }
      j += 1;
    }

    const text = normalizeCueText(chunkMeta.map((w) => w.word).join(' '));
    blocks.push(
      reanchorBlockTiming({
        text,
        words: cueWords(text),
        wordTimeline: chunkMeta,
        boundaryReason,
        boundaryGap: boundaryGap != null ? Number(boundaryGap.toFixed(4)) : null
      })
    );
    i = j;
  }

  // Remove progressive accumulation patterns by replacing previous growing text.
  const collapsed = [];
  for (const b of blocks) {
    const prev = collapsed[collapsed.length - 1];
    if (!prev) {
      collapsed.push({ ...b });
      continue;
    }
    const prevNorm = normalizeForAccumulation(prev.text);
    const nextNorm = normalizeForAccumulation(b.text);
    const growing = nextNorm.startsWith(prevNorm) && nextNorm.length > prevNorm.length;
    const near = b.start <= prev.end + 0.25;
    if (growing && near) {
      prev.text = b.text;
      prev.words = b.words;
      prev.wordTimeline = [...(prev.wordTimeline || []), ...(b.wordTimeline || [])];
      const merged = reanchorBlockTiming(prev);
      Object.assign(prev, merged);
      continue;
    }
    collapsed.push({ ...b });
  }

  const bounded = [];
  for (const b of collapsed) {
    const splits = splitLongBlockOnWordBoundaries(b, maxDurationSec);
    bounded.push(...splits);
  }

  const smoothed = [];
  for (const block of bounded) {
    const cur = reanchorBlockTiming({ ...block });
    const prev = smoothed[smoothed.length - 1];
    if (prev) {
      const prevDur = prev.end - prev.start;
      if (prevDur < minDurationSec) {
        prev.text = `${prev.text} ${cur.text}`.trim();
        prev.words = cueWords(prev.text);
        prev.wordTimeline = [...(prev.wordTimeline || []), ...(cur.wordTimeline || [])];
        Object.assign(prev, reanchorBlockTiming(prev));
        continue;
      }
    }
    smoothed.push(cur);
  }
  if (smoothed.length > 1) {
    const last = smoothed[smoothed.length - 1];
    const prev = smoothed[smoothed.length - 2];
    if (last.end - last.start < minDurationSec) {
      prev.text = `${prev.text} ${last.text}`.trim();
      prev.words = cueWords(prev.text);
      prev.wordTimeline = [...(prev.wordTimeline || []), ...(last.wordTimeline || [])];
      Object.assign(prev, reanchorBlockTiming(prev));
      smoothed.pop();
    }
  }

  eliminateCaptionOverlaps(smoothed, SYNC_OVERLAP_GAP_SEC);
  detectAndCorrectDrift(smoothed);
  applySpeechRatePersistence(smoothed);
  eliminateCaptionOverlaps(smoothed, SYNC_OVERLAP_GAP_SEC);

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
    '[asr-stabilization-debug]',
    timelineResult.logs
  );
  console.log(
    '[word-timing-debug]',
    out.map((c) => ({
      words: c.words,
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
    emphasisWords: cue.emphasisWords
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

/**
 * Burn/export: preserve segment start/end exactly as SRT/preview (no rhythm re-chunking).
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
    cues.push({
      id: `src-${i}`,
      index: i,
      start,
      end,
      duration: Number((end - start).toFixed(3)),
      text,
      words: cueWords(text),
      sourceStart: start,
      sourceEnd: end
    });
  }
  return dedupeOverlappingBurnCues(cues);
}

/**
 * Remove stacked "growing" captions (common with word-by-word ASR) before ASS burn-in.
 */
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
