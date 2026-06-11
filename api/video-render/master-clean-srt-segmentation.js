/**
 * Master Clean SRT segmentation — short-form rules (single source of truth).
 * Target: 1 line per cue, max 5 words, max 42 visible chars.
 * Split at punctuation first, natural pauses second; never split names/numbers.
 * ZERO WORD LOSS: every input token appears in exactly one output cue.
 */
import { assertCompleteWordPartition, cueWords as integrityCueWords } from './clean-srt-word-integrity.js';

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\-][\p{L}\p{M}\p{N}]+)*/gu;

export const SHORT_FORM_MAX_WORDS = 5;
export const SHORT_FORM_MAX_CHARS = 42;
/** Vertical 9:16 — Captions-app style: few words, fast turnover. */
export const VERTICAL_SHORT_FORM_MAX_WORDS = 3;
export const VERTICAL_SHORT_FORM_MAX_CHARS = 12;
export const PAUSE_GAP_SEC = 0.28;

function cueWords(text) {
  return String(text || '').match(TOKEN_RE) || [];
}

function normalizeCueText(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleCharCount(text) {
  return normalizeCueText(text).length;
}

/** Title-case or digit/currency tokens must not be split across cues. */
function isProtectedToken(word, prevWord) {
  const w = String(word || '');
  if (!w) return false;
  if (/\d/.test(w) || /^\$/.test(w) || /%$/.test(w)) return true;
  if (/^[A-Z][\p{L}\p{M}']+$/.test(w) && w.length > 1) {
    if (prevWord && /^[A-Z][\p{L}\p{M}']+$/.test(prevWord)) return true;
    return true;
  }
  return false;
}

function isProtectedBoundary(words, splitAfterIndex) {
  const left = words[splitAfterIndex];
  const right = words[splitAfterIndex + 1];
  if (!left || !right) return false;
  if (isProtectedToken(left, words[splitAfterIndex - 1])) return true;
  if (isProtectedToken(right, left)) return true;
  if (/\d/.test(left) && /\d/.test(right)) return true;
  if (/^\$/.test(left) || /^\$/.test(right)) return true;
  return false;
}

function buildWordTimeline(segment, words) {
  const segStart = Number(segment.start);
  const segEnd = Number(segment.end);
  const raw = Array.isArray(segment.words) ? segment.words : [];
  const timed = raw.filter((w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)));
  if (timed.length >= words.length && words.length) {
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const tw = timed[i] || timed[timed.length - 1];
      out.push({
        word: words[i],
        start: Number(tw.start),
        end: Number(tw.end)
      });
    }
    return out;
  }
  const dur = Math.max(0.08 * words.length, segEnd - segStart);
  const per = dur / Math.max(1, words.length);
  return words.map((word, i) => {
    const start = segStart + i * per;
    const end = Math.min(segEnd, Math.max(start + 0.06, segStart + (i + 1) * per));
    return { word, start, end };
  });
}

function cueTimingFromWordRange(timeline, tokenStart, tokenEnd, segStart, segEnd) {
  const slice = timeline.slice(tokenStart, tokenEnd + 1);
  if (!slice.length) {
    return { start: segStart, end: segEnd };
  }
  return {
    start: Number(slice[0].start),
    end: Number(slice[slice.length - 1].end)
  };
}

/** Never exceed maxWords/maxChars even when protected-token logic delayed a split. */
function enforceHardCaps(specs, words, maxWords, maxChars) {
  const out = [];
  for (const spec of specs) {
    let cursor = spec.tokenStart;
    const end = spec.tokenEnd;
    while (cursor <= end) {
      let chunkEnd = Math.min(end, cursor + maxWords - 1);
      while (chunkEnd > cursor && visibleCharCount(words.slice(cursor, chunkEnd + 1).join(' ')) > maxChars) {
        chunkEnd -= 1;
      }
      if (chunkEnd < cursor) chunkEnd = cursor;
      out.push({
        tokenStart: cursor,
        tokenEnd: chunkEnd,
        boundaryReason: spec.boundaryReason || 'hard_cap'
      });
      cursor = chunkEnd + 1;
    }
  }
  return out;
}

function findPauseSplitIndices(timeline) {
  const indices = [];
  for (let i = 0; i < timeline.length - 1; i++) {
    const gap = Number(timeline[i + 1].start) - Number(timeline[i].end);
    if (gap >= PAUSE_GAP_SEC) indices.push(i);
  }
  return indices;
}

/**
 * Split one transcript segment into master cues (text + timing only).
 * @param {{ start: number, end: number, text: string, words?: object[] }} segment
 * @param {object} [opts]
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function segmentSegmentToMasterCues(segment, opts = {}) {
  const maxWords = Math.max(1, Number(opts.maxWords ?? SHORT_FORM_MAX_WORDS));
  const maxChars = Math.max(10, Number(opts.maxChars ?? SHORT_FORM_MAX_CHARS));
  const text = normalizeCueText(segment?.text);
  if (!text) return [];

  const words = cueWords(text);
  if (!words.length) return [];

  const segStart = Number(segment.start);
  const segEnd = Number(segment.end);
  const timeline = buildWordTimeline(segment, words);

  const specs = [];
  let bucketStart = 0;

  for (let i = 0; i < words.length; i++) {
    const token = words[i];
    const chunkLen = i - bucketStart + 1;
    const chunkText = words.slice(bucketStart, i + 1).join(' ');
    const hitPunctStrong = /[.!?…]["']?$/.test(token);
    const hitPunctSoft = /[,;:]["']?$/.test(token) && chunkLen >= 2;
    const hitMaxWords = chunkLen >= maxWords;
    const hitMaxChars = visibleCharCount(chunkText) >= maxChars;
    const atEnd = i === words.length - 1;

    if (hitPunctStrong || hitPunctSoft || hitMaxWords || hitMaxChars || atEnd) {
      let splitAt = i;
      if ((hitMaxWords || hitMaxChars) && !hitPunctStrong && !hitPunctSoft && chunkLen > 1) {
        while (splitAt > bucketStart && isProtectedBoundary(words, splitAt - 1)) {
          splitAt -= 1;
        }
      }
      specs.push({
        tokenStart: bucketStart,
        tokenEnd: splitAt,
        boundaryReason: hitPunctStrong
          ? 'punctuation'
          : hitPunctSoft
            ? 'punctuation_soft'
            : hitMaxWords
              ? 'max_words'
              : hitMaxChars
                ? 'max_chars'
                : 'segment_end'
      });
      bucketStart = splitAt + 1;
      i = splitAt;
    }
  }

  const pauseIndices = findPauseSplitIndices(timeline);
  const refined = [];
  for (const spec of specs) {
    const internalPauses = pauseIndices.filter((idx) => idx >= spec.tokenStart && idx < spec.tokenEnd);
    if (!internalPauses.length) {
      refined.push(spec);
      continue;
    }
    let curStart = spec.tokenStart;
    for (const pauseIdx of internalPauses) {
      if (pauseIdx < curStart) continue;
      if (pauseIdx - curStart + 1 < 2) continue;
      if (isProtectedBoundary(words, pauseIdx)) continue;
      refined.push({
        tokenStart: curStart,
        tokenEnd: pauseIdx,
        boundaryReason: 'speech_pause'
      });
      curStart = pauseIdx + 1;
    }
    if (curStart <= spec.tokenEnd) {
      refined.push({
        tokenStart: curStart,
        tokenEnd: spec.tokenEnd,
        boundaryReason: spec.boundaryReason
      });
    }
  }

  const partitionSpecs = enforceHardCaps(refined.length ? refined : specs, words, maxWords, maxChars);
  if (!partitionSpecs.length && words.length) {
    partitionSpecs.push({
      tokenStart: 0,
      tokenEnd: words.length - 1,
      boundaryReason: 'fallback_single_cue'
    });
  }
  assertCompleteWordPartition(words, partitionSpecs);

  const merged = partitionSpecs.map((spec) => ({
    ...spec,
    text: words.slice(spec.tokenStart, spec.tokenEnd + 1).join(' ')
  }));

  return merged.map((spec) => {
    const { start, end } = cueTimingFromWordRange(
      timeline,
      spec.tokenStart,
      spec.tokenEnd,
      segStart,
      segEnd
    );
    return {
      start: Number(start.toFixed(3)),
      end: Number(Math.max(start + 0.05, end).toFixed(3)),
      text: spec.text
    };
  });
}

/**
 * @param {{ start: number, end: number, text: string, words?: object[] }[]} preparedSegments
 */
export function segmentPreparedSegmentsToMasterCues(preparedSegments, opts = {}) {
  const out = [];
  for (const seg of preparedSegments || []) {
    if (!seg || seg.end <= seg.start) continue;
    const pieces = segmentSegmentToMasterCues(seg, opts);
    for (const piece of pieces) {
      if (piece.text && piece.end > piece.start) out.push(piece);
    }
  }
  const sourceWords = integrityCueWords(
    (preparedSegments || []).map((s) => String(s?.text || '')).join(' ')
  );
  const outWords = integrityCueWords(out.map((p) => p.text).join(' '));
  if (sourceWords.length !== outWords.length) {
    const err = new Error(
      `SUBTITLE_WORD_LOSS: segment_batch word count ${sourceWords.length} → ${outWords.length}`
    );
    err.code = 'SUBTITLE_WORD_LOSS';
    throw err;
  }
  for (let i = 0; i < sourceWords.length; i++) {
    if (sourceWords[i].toLowerCase() !== outWords[i].toLowerCase()) {
      const err = new Error(`SUBTITLE_WORD_LOSS: word mismatch at ${i} (${sourceWords[i]} vs ${outWords[i]})`);
      err.code = 'SUBTITLE_WORD_LOSS';
      throw err;
    }
  }
  return out;
}
