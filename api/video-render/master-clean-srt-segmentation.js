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
/** Vertical 9:16 — Captions-app style: short beats, min 2 words when possible. */
export const VERTICAL_SHORT_FORM_MAX_WORDS = 5;
export const VERTICAL_SHORT_FORM_MAX_CHARS = 18;
export const VERTICAL_SHORT_FORM_MIN_WORDS = 2;
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

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rebuild cue text from tokens while keeping ? ! . attached to the last word. */
function extractCueTextWithPunctuation(sourceText, allTokens, tokenStart, tokenEnd) {
  const tokens = allTokens.slice(tokenStart, tokenEnd + 1);
  if (!tokens.length) return '';
  const src = normalizeCueText(sourceText);
  if (!src) return tokens.join(' ');

  let pos = 0;
  let spanStart = -1;
  let spanEnd = -1;
  for (const tok of tokens) {
    const re = new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'iu');
    const slice = src.slice(pos);
    const m = slice.match(re);
    if (!m) return tokens.join(' ');
    const absStart = pos + m.index;
    if (spanStart < 0) spanStart = absStart;
    spanEnd = absStart + m[0].length;
    pos = spanEnd;
  }
  const trail = src.slice(spanEnd).match(/^[\s]*([.!?…]+["']?)/);
  if (trail) spanEnd += trail[0].length;
  return src.slice(spanStart, spanEnd).trim();
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

function normToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}']/gu, '');
}

function providerWordText(w) {
  return String(w?.word ?? w?.text ?? '').trim();
}

/** Greedy text match — ASR token count/order often differs from cueWords(). */
function alignProviderWordsToTokens(raw, tokens) {
  const timed = (raw || []).filter(
    (w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end))
  );
  if (!timed.length || !tokens.length) return null;

  const out = [];
  let ri = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const want = normToken(tokens[ti]);
    let found = null;
    const searchEnd = Math.min(ri + 5, timed.length);
    for (let j = ri; j < searchEnd; j++) {
      if (normToken(providerWordText(timed[j])) === want) {
        found = timed[j];
        ri = j + 1;
        break;
      }
    }
    if (!found) return null;
    out.push({
      word: tokens[ti],
      start: Number(found.start),
      end: Number(found.end)
    });
  }
  return out.length === tokens.length ? out : null;
}

function buildWordTimeline(segment, words) {
  const segStart = Number(segment.start);
  const segEnd = Number(segment.end);
  const raw = Array.isArray(segment.words) ? segment.words : [];
  const timed = raw.filter((w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)));

  const aligned = alignProviderWordsToTokens(timed, words);
  if (aligned) return aligned;

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
function enforceHardCaps(specs, words, maxWords, maxChars, minWords = 1) {
  const out = [];
  const minW = Math.max(1, Math.min(maxWords, Number(minWords) || 1));
  for (const spec of specs) {
    let cursor = spec.tokenStart;
    const end = spec.tokenEnd;
    while (cursor <= end) {
      let chunkEnd = Math.min(end, cursor + maxWords - 1);
      while (chunkEnd > cursor && visibleCharCount(words.slice(cursor, chunkEnd + 1).join(' ')) > maxChars) {
        chunkEnd -= 1;
      }
      if (chunkEnd < cursor) chunkEnd = cursor;
      if (minW >= 2 && chunkEnd < end && chunkEnd - cursor + 1 < minW) {
        const extended = Math.min(end, cursor + minW - 1, cursor + maxWords - 1);
        const extText = words.slice(cursor, extended + 1).join(' ');
        if (visibleCharCount(extText) <= maxChars) {
          chunkEnd = extended;
        }
      }
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

/** Merge lone single-word cues into neighbors when caps allow (avoids flash "IS" / "A"). */
function mergeOrphanSingleWordSpecs(specs, words, maxWords, maxChars) {
  if (!Array.isArray(specs) || specs.length < 2) return specs;
  const out = specs.map((s) => ({ ...s }));

  for (let i = 0; i < out.length - 1; i++) {
    const spec = out[i];
    const wc = spec.tokenEnd - spec.tokenStart + 1;
    if (wc !== 1) continue;
    const next = out[i + 1];
    const nextWc = next.tokenEnd - next.tokenStart + 1;
    const mergedLen = wc + nextWc;
    const mergedText = words.slice(spec.tokenStart, next.tokenEnd + 1).join(' ');
    if (mergedLen <= maxWords && visibleCharCount(mergedText) <= maxChars) {
      next.tokenStart = spec.tokenStart;
      out.splice(i, 1);
      i -= 1;
      continue;
    }
    if (nextWc >= 2) {
      const peelEnd = next.tokenStart;
      const pairText = words.slice(spec.tokenStart, peelEnd + 1).join(' ');
      if (visibleCharCount(pairText) <= maxChars) {
        out[i] = { ...spec, tokenEnd: peelEnd, boundaryReason: 'orphan_peel_forward' };
        next.tokenStart = peelEnd + 1;
        if (next.tokenStart > next.tokenEnd) {
          out.splice(i + 1, 1);
        }
        i -= 1;
      }
    }
  }

  for (let i = 1; i < out.length; i++) {
    const spec = out[i];
    const wc = spec.tokenEnd - spec.tokenStart + 1;
    if (wc !== 1) continue;
    const prev = out[i - 1];
    const mergedLen = prev.tokenEnd - prev.tokenStart + 1 + 1;
    const mergedText = words.slice(prev.tokenStart, spec.tokenEnd + 1).join(' ');
    if (mergedLen <= maxWords && visibleCharCount(mergedText) <= maxChars) {
      prev.tokenEnd = spec.tokenEnd;
      out.splice(i, 1);
      i -= 1;
    }
  }

  if (out.length >= 2) {
    const last = out[out.length - 1];
    const lastWc = last.tokenEnd - last.tokenStart + 1;
    if (lastWc === 1) {
      const prev = out[out.length - 2];
      const prevWc = prev.tokenEnd - prev.tokenStart + 1;
      const mergedLen = prevWc + 1;
      const mergedText = words.slice(prev.tokenStart, last.tokenEnd + 1).join(' ');
      const mergedChars = visibleCharCount(mergedText);
      if (mergedLen <= maxWords && mergedChars <= maxChars) {
        prev.tokenEnd = last.tokenEnd;
        out.pop();
      } else if (
        mergedLen === maxWords + 1 &&
        mergedChars <= maxChars + 8 &&
        /[.!?…]["']?$/i.test(words[last.tokenEnd] || '')
      ) {
        prev.tokenEnd = last.tokenEnd;
        out.pop();
      } else if (prevWc >= 2) {
        const peelIdx = prev.tokenEnd;
        const pairText = words.slice(peelIdx, last.tokenEnd + 1).join(' ');
        if (visibleCharCount(pairText) <= maxChars && peelIdx > prev.tokenStart) {
          prev.tokenEnd = peelIdx - 1;
          last.tokenStart = peelIdx;
          last.boundaryReason = 'orphan_peel_back';
        }
      }
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

  const minWords = Math.max(1, Number(opts.minWords ?? 1));
  const capped = enforceHardCaps(
    refined.length ? refined : specs,
    words,
    maxWords,
    maxChars,
    minWords
  );
  const partitionSpecs = mergeOrphanSingleWordSpecs(capped, words, maxWords, maxChars);
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
    text: extractCueTextWithPunctuation(text, words, spec.tokenStart, spec.tokenEnd)
  }));

  return merged.map((spec) => {
    const slice = timeline.slice(spec.tokenStart, spec.tokenEnd + 1);
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
      text: spec.text,
      words: slice.map((w) => ({ word: w.word, start: w.start, end: w.end }))
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
