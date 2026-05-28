/**
 * Subtitle pipeline with strict source-of-truth preservation.
 * Styling layers must never mutate transcript semantics.
 */

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

function normalizeCueText(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cueWords(text) {
  return String(text || '').match(TOKEN_RE) || [];
}

function normalizeWord(w) {
  return String(w || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}$%]/gu, '');
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

function composeRhythmBlocks(rawSegments, opts = {}) {
  const baseMaxWords = Math.max(3, Math.min(5, Number(opts.maxWordsPerBlock ?? 5)));
  const minDurationSec = Math.max(0.4, Number(opts.minDurationSec ?? 0.7));
  const maxDurationSec = Math.max(minDurationSec, Number(opts.maxDurationSec ?? 2.6));
  const overlapGuardSec = Math.max(0, Number(opts.overlapGuardSec ?? 0.04));
  const source = Array.isArray(rawSegments) ? rawSegments : [];
  const blocks = [];

  for (const seg of source) {
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) continue;
    const text = normalizeCueText(seg.text || '');
    if (!text) continue;
    const wordsList = cueWords(text);
    if (!wordsList.length) continue;

    const speechRate = wordsList.length / Math.max(0.01, Number(seg.end) - Number(seg.start));
    const dynamicMaxWords = speechRate > 3.8 ? 3 : speechRate > 2.7 ? 4 : baseMaxWords;
    const chunks = splitPhraseToWordChunks(wordsList, dynamicMaxWords);
    const span = Math.max(0.01, Number(seg.end) - Number(seg.start));
    const chunkDur = span / Math.max(1, chunks.length);

    for (let i = 0; i < chunks.length; i++) {
      const cStart = Number(seg.start) + i * chunkDur;
      const cEnd = i === chunks.length - 1 ? Number(seg.end) : Number(seg.start) + (i + 1) * chunkDur;
      blocks.push({
        text: chunks[i],
        start: cStart,
        end: cEnd,
        words: cueWords(chunks[i])
      });
    }
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
      prev.end = Math.max(prev.end, b.end);
      continue;
    }
    collapsed.push({ ...b });
  }

  // Split overly long blocks before anti-flicker merge.
  const bounded = [];
  for (const b of collapsed) {
    const dur = b.end - b.start;
    if (dur <= maxDurationSec) {
      bounded.push(b);
      continue;
    }
    const parts = Math.ceil(dur / maxDurationSec);
    const per = dur / parts;
    const wordsPerPart = Math.max(2, Math.ceil((b.words || []).length / parts));
    for (let i = 0; i < parts; i++) {
      const start = b.start + i * per;
      const end = i === parts - 1 ? b.end : b.start + (i + 1) * per;
      const w = (b.words || []).slice(i * wordsPerPart, (i + 1) * wordsPerPart);
      bounded.push({
        text: w.join(' ') || b.text,
        start,
        end,
        words: cueWords(w.join(' ') || b.text)
      });
    }
  }

  // Anti-flicker + overlap smoothing
  const smoothed = [];
  for (const block of bounded) {
    const cur = { ...block };
    const prev = smoothed[smoothed.length - 1];
    if (prev && cur.start < prev.end - overlapGuardSec) {
      cur.start = prev.end - overlapGuardSec;
    }
    if (prev) {
      const prevDur = prev.end - prev.start;
      if (prevDur < minDurationSec) {
        prev.text = `${prev.text} ${cur.text}`.trim();
        prev.words = cueWords(prev.text);
        prev.end = Math.max(prev.end, cur.end);
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
      prev.end = Math.max(prev.end, last.end);
      smoothed.pop();
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
    _words: b.words
  }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (!prev.emphasisWords?.length || !cur.emphasisWords?.length) continue;
    cur.emphasisWords = cur.emphasisWords.filter((w) => !prev.emphasisWords.includes(w)).slice(0, 2);
  }
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
 * Immutable source-of-truth subtitle layer.
 * Never rewrites transcript semantics.
 */
export function buildCanonicalSubtitles(rawSegments) {
  const raw = Array.isArray(rawSegments) ? rawSegments : [];
  return composeRhythmBlocks(raw, {
    maxWordsPerBlock: 5,
    minDurationSec: 0.7,
    maxDurationSec: 2.6,
    overlapGuardSec: 0.04
  });
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
