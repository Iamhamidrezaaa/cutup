/**
 * Zero word-loss validation: post_processed → clean_srt must preserve every word.
 */
import { stripBurnNonSpeechTags } from './subtitle-pipeline.js';

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\-][\p{L}\p{M}\p{N}]+)*/gu;

function normalizeCueText(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cueWords(text) {
  return String(text || '').match(TOKEN_RE) || [];
}

export function normalizeWordToken(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}']/gu, '');
}

/**
 * Ordered word list from segments (joined cue text, normalized).
 */
export function extractNormalizedWords(segments) {
  const words = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    const text = normalizeCueText(seg?.text);
    if (!text) continue;
    for (const w of cueWords(text)) {
      const n = normalizeWordToken(w);
      if (n) words.push(n);
    }
  }
  return words;
}

export function joinedNormalizedWordText(segments) {
  return extractNormalizedWords(segments).join(' ');
}

function providerWordText(w) {
  return String(w?.word ?? w?.text ?? '').trim();
}

/**
 * Attach top-level ASR word timestamps to segments missing segment.words (Whisper often omits them).
 */
export function attachProviderWordsToSegments(segments, providerWords) {
  const list = Array.isArray(providerWords) ? providerWords : [];
  if (!list.length) return Array.isArray(segments) ? segments : [];

  const words = list
    .filter((w) => providerWordText(w) && Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)))
    .sort((a, b) => Number(a.start) - Number(b.start));

  return (segments || []).map((seg) => {
    if (Array.isArray(seg?.words) && seg.words.length) return seg;
    const ss = Number(seg?.start);
    const se = Number(seg?.end);
    if (!Number.isFinite(ss) || !Number.isFinite(se)) return seg;
    const attached = words.filter((w) => {
      const ws = Number(w.start);
      const we = Number(w.end);
      const mid = (ws + we) / 2;
      return mid >= ss - 0.08 && mid <= se + 0.08;
    });
    if (!attached.length) return seg;
    return { ...seg, words: attached.map((w) => ({ ...w })) };
  });
}

/**
 * Post-processed input for clean SRT: strip non-speech tags only — no merge, no drop.
 */
export function normalizePostProcessedForCleanSrt(segments, opts = {}) {
  const base = (Array.isArray(segments) ? segments : [])
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start)
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: stripBurnNonSpeechTags(s.text),
      words: s.words
    }))
    .filter((s) => normalizeCueText(s.text))
    .sort((a, b) => a.start - b.start);
  return attachProviderWordsToSegments(base, opts.providerWords);
}

/**
 * @returns {{ ok: boolean, missingWords: object[], missingCharacters: number, missingSegments: object[], sourceWordCount: number, cleanWordCount: number }}
 */
export function buildCleanSrtWordLossReport(postProcessed, cleanSrt) {
  const sourceWords = extractNormalizedWords(postProcessed);
  const cleanWords = extractNormalizedWords(cleanSrt);
  const sourceJoined = sourceWords.join(' ');
  const cleanJoined = cleanWords.join(' ');

  if (sourceJoined === cleanJoined) {
    return {
      ok: true,
      missingWords: [],
      missingCharacters: 0,
      missingSegments: [],
      sourceWordCount: sourceWords.length,
      cleanWordCount: cleanWords.length
    };
  }

  const missingWords = [];
  let ci = 0;
  for (let si = 0; si < sourceWords.length; si++) {
    if (ci < cleanWords.length && cleanWords[ci] === sourceWords[si]) {
      ci += 1;
      continue;
    }
    missingWords.push({
      word: sourceWords[si],
      sourceIndex: si,
      cleanIndexAtMismatch: ci < cleanWords.length ? ci : null,
      cleanWordAtMismatch: ci < cleanWords.length ? cleanWords[ci] : null
    });
  }

  const extraCleanWords =
    ci < cleanWords.length
      ? cleanWords.slice(ci).map((word, offset) => ({
          word,
          cleanIndex: ci + offset,
          reason: 'extra_in_clean_srt'
        }))
      : [];

  const missingSegments = [];
  for (let i = 0; i < (postProcessed || []).length; i++) {
    const seg = postProcessed[i];
    const segWords = extractNormalizedWords([seg]);
    if (!segWords.length) continue;
    const segJoined = segWords.join(' ');
    if (!cleanJoined.includes(segJoined)) {
      missingSegments.push({
        segmentIndex: i,
        start: Number(seg?.start),
        end: Number(seg?.end),
        text: String(seg?.text || '').slice(0, 160),
        segmentWordCount: segWords.length
      });
    }
  }

  return {
    ok: false,
    missingWords: [...missingWords, ...extraCleanWords],
    missingCharacters: Math.max(0, sourceJoined.length - cleanJoined.length),
    missingSegments,
    sourceWordCount: sourceWords.length,
    cleanWordCount: cleanWords.length,
    sourceJoinedPreview: sourceJoined.slice(0, 240),
    cleanJoinedPreview: cleanJoined.slice(0, 240)
  };
}

export function assertCleanSrtWordIntegrity(postProcessed, cleanSrt, ctx = {}) {
  const report = buildCleanSrtWordLossReport(postProcessed, cleanSrt);
  if (report.ok) {
    console.log(
      JSON.stringify({
        event: 'subtitle_word_integrity_passed',
        sourceWordCount: report.sourceWordCount,
        cleanWordCount: report.cleanWordCount,
        ...ctx
      })
    );
    return report;
  }

  console.error(
    JSON.stringify({
      event: 'subtitle_word_loss',
      ...report,
      ...ctx
    })
  );

  const err = new Error(
    `SUBTITLE_WORD_LOSS: ${report.missingWords.length} word mismatch(es); source=${report.sourceWordCount} clean=${report.cleanWordCount}`
  );
  err.code = 'SUBTITLE_WORD_LOSS';
  err.report = report;
  throw err;
}

/**
 * Ensure token ranges [tokenStart, tokenEnd] partition all word indices exactly once.
 */
export function assertCompleteWordPartition(words, specs) {
  const list = Array.isArray(words) ? words : [];
  const covered = new Array(list.length).fill(false);
  for (const spec of specs || []) {
    const start = Number(spec.tokenStart);
    const end = Number(spec.tokenEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error('SUBTITLE_WORD_LOSS: invalid_word_partition_spec');
    }
    for (let i = start; i <= end; i++) {
      if (i < 0 || i >= list.length || covered[i]) {
        const err = new Error(`SUBTITLE_WORD_LOSS: word_partition_gap_or_overlap at index ${i}`);
        err.code = 'SUBTITLE_WORD_LOSS';
        throw err;
      }
      covered[i] = true;
    }
  }
  const firstGap = covered.findIndex((v) => !v);
  if (firstGap >= 0) {
    const err = new Error(`SUBTITLE_WORD_LOSS: uncovered_word_index ${firstGap} (${list[firstGap]})`);
    err.code = 'SUBTITLE_WORD_LOSS';
    throw err;
  }
  return true;
}
