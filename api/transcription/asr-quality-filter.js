/**
 * Remove unreliable Whisper segments/words before subtitle generation.
 * Heuristics align with api/asr-diagnostics.js but actively mutate output.
 */

const HALLUCINATION_PATTERNS = [
  /thank you for watching/i,
  /thanks for watching/i,
  /please subscribe/i,
  /subtitles by/i,
  /amara\.org/i,
  /^\[music\]$/i,
  /^\[applause\]$/i,
  /^\[silence\]$/i,
  /subscribe to (my|the) channel/i,
  /like and subscribe/i
];

const DEFAULT_LOGPROB_THRESHOLD = Number(process.env.ASR_FILTER_LOGPROB_MAX || -0.95);
const DEFAULT_NO_SPEECH_THRESHOLD = Number(process.env.ASR_FILTER_NO_SPEECH_MIN || 0.58);
const STRICT_LOGPROB_THRESHOLD = Number(process.env.ASR_FILTER_STRICT_LOGPROB_MAX || -0.72);
const STRICT_NO_SPEECH_THRESHOLD = Number(process.env.ASR_FILTER_STRICT_NO_SPEECH_MIN || 0.42);
const WORD_BRACKET_MAX_GAP_SEC = Number(process.env.ASR_FILTER_WORD_BRACKET_GAP_SEC || 6);

export function isKnownHallucinationText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return HALLUCINATION_PATTERNS.some((re) => re.test(t));
}

function segmentDurationSec(seg) {
  const start = Number(seg?.start);
  const end = Number(seg?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function isStrictSegment(seg, opts = {}) {
  return Boolean(
    opts.strict ||
      seg?.fromGapRetranscribe ||
      seg?.fromProviderWords ||
      seg?.fromWordGapFill
  );
}

/**
 * @param {object} seg
 * @param {{ strict?: boolean }} [opts]
 */
export function isUnreliableAsrSegment(seg, opts = {}) {
  const text = String(seg?.text || '').trim();
  if (!text) return true;

  if (isKnownHallucinationText(text)) return true;

  const logprob = Number(seg?.avg_logprob);
  const noSpeech = Number(seg?.no_speech_prob);
  const strict = isStrictSegment(seg, opts);
  const logThreshold = strict ? STRICT_LOGPROB_THRESHOLD : DEFAULT_LOGPROB_THRESHOLD;
  const speechThreshold = strict ? STRICT_NO_SPEECH_THRESHOLD : DEFAULT_NO_SPEECH_THRESHOLD;
  const dur = segmentDurationSec(seg);
  const tokenCount = text.split(/\s+/).filter(Boolean).length;

  if (Number.isFinite(noSpeech) && noSpeech >= speechThreshold) return true;
  if (Number.isFinite(logprob) && logprob <= logThreshold && tokenCount >= 2) return true;
  if (Number.isFinite(logprob) && logprob < -1.25 && tokenCount >= 1) return true;
  if (dur > 0 && dur < 0.14 && tokenCount > 3) return true;
  if (tokenCount <= 1 && dur > 2.5 && Number.isFinite(logprob) && logprob < -0.5) return true;

  return false;
}

/**
 * @param {object[]} segments
 * @param {{ strict?: boolean }} [opts]
 */
export function filterUnreliableAsrSegments(segments, opts = {}) {
  const input = Array.isArray(segments) ? segments : [];
  const kept = [];
  const removed = [];

  for (const seg of input) {
    if (isUnreliableAsrSegment(seg, opts)) {
      removed.push(seg);
    } else {
      kept.push(seg);
    }
  }

  return {
    segments: kept,
    removed,
    stats: {
      inputCount: input.length,
      keptCount: kept.length,
      removedCount: removed.length
    }
  };
}

function wordText(w) {
  return String(w?.word ?? w?.text ?? '').trim();
}

function findOverlappingSegment(word, segments) {
  const ws = Number(word?.start);
  const we = Number(word?.end);
  if (!Number.isFinite(ws) || !Number.isFinite(we)) return null;
  const mid = (ws + we) / 2;
  return (segments || []).find((seg) => {
    const ss = Number(seg?.start);
    const se = Number(seg?.end);
    return Number.isFinite(ss) && Number.isFinite(se) && mid >= ss && mid <= se;
  });
}

function isWordBracketedByReliableSpeech(word, reliableSegments) {
  const ws = Number(word?.start);
  const we = Number(word?.end);
  if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) return false;

  const sorted = [...(reliableSegments || [])].sort((a, b) => Number(a.start) - Number(b.start));
  if (!sorted.length) return false;

  const before = [...sorted].reverse().find((s) => Number(s.end) <= ws + 0.2);
  const after = sorted.find((s) => Number(s.start) >= we - 0.2);

  if (!before && !after) return false;
  if (before && after) {
    const gap = Number(after.start) - Number(before.end);
    if (gap < 0.35 || gap > WORD_BRACKET_MAX_GAP_SEC) return false;
    return ws >= Number(before.end) - 0.05 && we <= Number(after.start) + 0.05;
  }

  const anchor = before || after;
  const dist = before ? ws - Number(anchor.end) : Number(anchor.start) - we;
  return dist >= 0 && dist <= 1.2;
}

/**
 * Drop word timestamps that sit in silence tails or inherit unreliable segments.
 * @param {object[]} words
 * @param {object[]} anchorSegments raw provider segments (before word grouping)
 */
export function filterProviderWords(words, anchorSegments) {
  const list = Array.isArray(words) ? words : [];
  const segments = Array.isArray(anchorSegments) ? anchorSegments : [];
  const reliableSegments = segments.filter((s) => !isUnreliableAsrSegment(s));

  return list.filter((w) => {
    const text = wordText(w);
    if (!text || isKnownHallucinationText(text)) return false;

    const parent = findOverlappingSegment(w, segments);
    if (parent) return !isUnreliableAsrSegment(parent);

    return isWordBracketedByReliableSpeech(w, reliableSegments);
  });
}
