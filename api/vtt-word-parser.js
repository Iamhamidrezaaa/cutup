/**
 * YouTube / WebVTT → timed segments with optional per-word timestamps.
 * Preserves inline <00:00:01.234> markers instead of stripping them.
 */

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\u2019\-][\p{L}\p{M}\p{N}]+)*/gu;
const INLINE_TS_RE = /<(\d{2}):(\d{2}):(\d{2})[.,](\d{3})>/g;

export function parseVttClock(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export function parseVttCueRange(line) {
  const m = String(line || '').match(
    /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/
  );
  if (!m) return null;
  return {
    start: parseVttClock(m[1], m[2], m[3], m[4]),
    end: parseVttClock(m[5], m[6], m[7], m[8])
  };
}

function stripVttMarkup(text) {
  return String(text || '')
    .replace(/<c[^>]*>/gi, '')
    .replace(/<\/c>/gi, '')
    .replace(/<v[^>]*>/gi, '')
    .replace(/<\/v>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract words from a cue payload line; uses inline timestamps when present. */
export function extractWordsFromVttLine(rawLine, cueStart, cueEnd) {
  const line = String(rawLine || '');
  const words = [];
  let hasInline = false;

  const firstTsIdx = line.search(/<\d{2}:\d{2}:\d{2}[.,](\d{3})>/);
  if (firstTsIdx > 0) {
    const prefix = stripVttMarkup(line.slice(0, firstTsIdx));
    const prefixTokens = prefix.match(TOKEN_RE) || [];
    for (const tok of prefixTokens) {
      words.push({ word: tok, start: cueStart, end: cueStart });
    }
  }

  const re = /<(\d{2}):(\d{2}):(\d{2})[.,](\d{3})>([^<]*)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    hasInline = true;
    const start = parseVttClock(m[1], m[2], m[3], m[4]);
    const chunk = stripVttMarkup(m[5]);
    const tokens = chunk.match(TOKEN_RE) || [];
    for (const tok of tokens) {
      words.push({ word: tok, start, end: start });
    }
  }

  if (words.length) {
    for (let i = 0; i < words.length; i++) {
      const nextStart = i + 1 < words.length ? words[i + 1].start : cueEnd;
      words[i].end = Math.max(words[i].start + 0.04, nextStart);
    }
    words[words.length - 1].end = Math.max(words[words.length - 1].end, cueEnd);
    return { words, hasInlineTiming: hasInline };
  }

  const plain = stripVttMarkup(line.replace(INLINE_TS_RE, ''));
  const tokens = plain.match(TOKEN_RE) || [];
  if (!tokens.length) return { words: [], hasInlineTiming: false };

  const dur = Math.max(0.06 * tokens.length, cueEnd - cueStart);
  const per = dur / tokens.length;
  return {
    words: tokens.map((word, i) => {
      const start = cueStart + i * per;
      const end = Math.min(cueEnd, Math.max(start + 0.04, cueStart + (i + 1) * per));
      return { word, start, end };
    }),
    hasInlineTiming: false
  };
}

function parseVttBlocks(vttContent) {
  const body = String(vttContent || '')
    .replace(/^\uFEFF/, '')
    .replace(/^WEBVTT[^\n]*\n/i, '')
    .replace(/^Kind:[^\n]*\n/gim, '')
    .replace(/^Language:[^\n]*\n/gim, '')
    .trim();

  const chunks = body.split(/\n\s*\n/);
  const raw = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let timeIdx = 0;
    if (!lines[0].includes('-->')) timeIdx = 1;
    const range = parseVttCueRange(lines[timeIdx]);
    if (!range) continue;

    const payload = lines.slice(timeIdx + 1).join(' ');
    const { words, hasInlineTiming } = extractWordsFromVttLine(payload, range.start, range.end);
    const text = words.length ? words.map((w) => w.word).join(' ') : stripVttMarkup(payload);
    if (!text) continue;

    raw.push({
      start: range.start,
      end: range.end,
      text,
      words,
      hasInlineTiming
    });
  }
  return raw;
}

function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let inter = 0;
  for (const w of set1) if (set2.has(w)) inter += 1;
  return inter / Math.max(set1.size, set2.size, 1);
}

/** YouTube rolling captions: each cue may repeat prior text — keep only new words. */
export function dedupeRollingVttSegments(rawSegments) {
  const segments = [];
  let previousText = '';

  for (const current of rawSegments || []) {
    const currentText = String(current.text || '').trim();
    if (!currentText) continue;

    if (previousText && currentText.startsWith(previousText)) {
      const newText = currentText.slice(previousText.length).trim();
      if (!newText) continue;
      const prevWords = previousText.split(/\s+/).filter(Boolean).length;
      const newWords = (current.words || []).slice(prevWords);
      segments.push({
        start: current.start,
        end: current.end,
        text: newText,
        words: newWords.length ? newWords : undefined,
        hasInlineTiming: current.hasInlineTiming
      });
      previousText = currentText;
    } else {
      segments.push({ ...current, text: currentText });
      previousText = currentText;
    }
  }

  const unique = [];
  const seen = new Set();
  for (const seg of segments) {
    const key = seg.text.trim().toLowerCase();
    if (!seen.has(key) || key.length > 50) {
      unique.push(seg);
      seen.add(key);
    }
  }

  if (unique.length < segments.length * 0.5) {
    const smart = [];
    let lastText = '';
    for (const seg of segments) {
      const sim = calculateTextSimilarity(lastText, seg.text);
      if (sim < 0.7 || !lastText) {
        smart.push(seg);
        lastText = seg.text;
      }
    }
    return smart.length ? smart : segments;
  }
  return unique.length ? unique : segments;
}

export function flattenSegmentWords(segments) {
  const out = [];
  for (const seg of segments || []) {
    for (const w of seg.words || []) {
      if (!w?.word) continue;
      out.push({
        word: w.word,
        start: Number(w.start),
        end: Number(w.end)
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * @param {string} vttContent
 * @returns {{ segments: object[], hasWordTiming: boolean, hasInlineTiming: boolean, fullText: string }}
 */
export function parseVttToSegmentsWithWords(vttContent) {
  const raw = parseVttBlocks(vttContent);
  const segments = dedupeRollingVttSegments(raw);
  const hasInlineTiming = segments.some((s) => s.hasInlineTiming && (s.words || []).length > 0);
  const hasWordTiming = segments.some(
    (s) => Array.isArray(s.words) && s.words.length > 0 && Number.isFinite(s.words[0].start)
  );
  const fullText = segments.map((s) => s.text).join(' ');
  return {
    segments: segments.map(({ hasInlineTiming: _h, ...rest }) => rest),
    hasWordTiming,
    hasInlineTiming,
    fullText
  };
}
