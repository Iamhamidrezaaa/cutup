/**
 * Master subtitle cues — lock, guard, and sync validation (single source of truth).
 */
import { stripBurnNonSpeechTags } from './subtitle-pipeline.js';
import {
  segmentPreparedSegmentsToMasterCues,
  SHORT_FORM_MAX_CHARS,
  SHORT_FORM_MAX_WORDS
} from './master-clean-srt-segmentation.js';
import {
  assertCleanSrtWordIntegrity,
  normalizePostProcessedForCleanSrt
} from './clean-srt-word-integrity.js';
import { polishMasterCueTimeline } from './master-cue-sync-polish.js';

const TIMING_TOLERANCE_MS = 1;

function roundMs(sec) {
  return Math.round(Number(sec) * 1000);
}

function timingEqual(a, b) {
  return Math.abs(roundMs(a) - roundMs(b)) <= TIMING_TOLERANCE_MS;
}

/**
 * @param {object[]} cues
 * @param {object} [opts]
 * @returns {object[]}
 */
export function lockMasterCues(cues, opts = {}) {
  const prefix = String(opts.idPrefix || 'master');
  const locked = (Array.isArray(cues) ? cues : [])
    .filter((c) => c && Number(c.end) > Number(c.start))
    .map((cue, index) => {
      const start = Number(cue.start);
      const end = Number(cue.end);
      const text = String(cue.text || '').trim();
      if (!text) return null;
      const id = cue.id || `${prefix}-${index}`;
      return {
        id,
        index,
        start,
        end,
        text,
        locked: true,
        duration: Number((end - start).toFixed(3)),
        sourceStart: start,
        sourceEnd: end
      };
    })
    .filter(Boolean);

  console.log(
    JSON.stringify({
      event: 'subtitle_lock_created',
      cueCount: locked.length,
      firstCue: locked[0]
        ? { id: locked[0].id, start: locked[0].start, end: locked[0].end, text: locked[0].text.slice(0, 80) }
        : null
    })
  );
  return locked;
}

export function logSubtitleLockViolation(details) {
  console.error(
    JSON.stringify({
      event: 'subtitle_lock_violation',
      ...details
    })
  );
}

export function logSubtitleSyncValidationFailed(details) {
  console.error(
    JSON.stringify({
      event: 'subtitle_sync_validation_failed',
      ...details
    })
  );
}

export function logSubtitleSyncValidationPassed(details) {
  console.log(
    JSON.stringify({
      event: 'subtitle_sync_validation_passed',
      ...details
    })
  );
}

/**
 * Reject timing or text mutations on locked cues (translation may change text only).
 */
export function assertLockedCueImmutable(original, candidate, operation = 'unknown') {
  if (!original?.locked) return;
  const op = String(operation || 'unknown');

  if (!timingEqual(original.start, candidate?.start) || !timingEqual(original.end, candidate?.end)) {
    logSubtitleLockViolation({
      operation: op,
      cueId: original.id,
      field: 'timing',
      expected: { start: original.start, end: original.end },
      actual: { start: candidate?.start, end: candidate?.end }
    });
    const err = new Error('subtitle_lock_violation: timing');
    err.code = 'SUBTITLE_LOCK_VIOLATION';
    throw err;
  }

  if (op !== 'translation' && String(original.text || '') !== String(candidate?.text || '')) {
    logSubtitleLockViolation({
      operation: op,
      cueId: original.id,
      field: 'text',
      expected: String(original.text || '').slice(0, 120),
      actual: String(candidate?.text || '').slice(0, 120)
    });
    const err = new Error('subtitle_lock_violation: text');
    err.code = 'SUBTITLE_LOCK_VIOLATION';
    throw err;
  }
}

export function guardLockedCueArray(originalCues, nextCues, operation) {
  const orig = Array.isArray(originalCues) ? originalCues : [];
  const next = Array.isArray(nextCues) ? nextCues : [];
  if (orig.some((c) => c?.locked) && orig.length !== next.length) {
    logSubtitleLockViolation({
      operation,
      field: 'cue_count',
      expected: orig.length,
      actual: next.length
    });
    const err = new Error('subtitle_lock_violation: cue_count');
    err.code = 'SUBTITLE_LOCK_VIOLATION';
    throw err;
  }
  for (let i = 0; i < orig.length; i++) {
    if (orig[i]?.locked) assertLockedCueImmutable(orig[i], next[i], operation);
  }
  return next;
}

/**
 * Normalize already-locked input segments (no re-segmentation).
 */
export function normalizeLockedMasterCues(rawSegments) {
  const cues = (Array.isArray(rawSegments) ? rawSegments : [])
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start)
    .map((seg, i) => {
      const text = stripBurnNonSpeechTags(seg.text);
      if (!text) return null;
      const start = Number(seg.start);
      const end = Number(seg.end);
      return {
        id: seg.id || `master-${i}`,
        index: i,
        start,
        end,
        text,
        locked: true,
        duration: Number((end - start).toFixed(3)),
        sourceStart: start,
        sourceEnd: end,
        words: seg.words
      };
    })
    .filter(Boolean);
  return cues;
}

/**
 * Transcript → Master Clean SRT (segment + lock). Only stage that may set cue timing/text.
 */
export function buildMasterCleanSrtFromSegments(rawSegments, opts = {}) {
  const shortForm = opts.shortForm !== false;
  const prepared = normalizePostProcessedForCleanSrt(rawSegments);
  const segmented = shortForm
    ? segmentPreparedSegmentsToMasterCues(prepared, {
        maxWords: opts.maxWords ?? SHORT_FORM_MAX_WORDS,
        maxChars: opts.maxChars ?? SHORT_FORM_MAX_CHARS,
        minWords: opts.minWords
      })
    : prepared.map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
        text: stripBurnNonSpeechTags(s.text)
      }));

  const polished = polishMasterCueTimeline(segmented);

  if (opts.validateWordIntegrity !== false) {
    assertCleanSrtWordIntegrity(prepared, polished, {
      stage: 'post_processed_to_clean_srt',
      traceId: opts.traceId || null
    });
  }

  return lockMasterCues(polished, opts);
}

/**
 * Apply translation text onto locked master cues (timing immutable).
 */
export function applyTranslationToLockedCues(lockedCues, translatedSegments) {
  const master = Array.isArray(lockedCues) ? lockedCues : [];
  const translated = Array.isArray(translatedSegments) ? translatedSegments : [];
  if (master.length !== translated.length) {
    logSubtitleLockViolation({
      operation: 'translation',
      field: 'cue_count',
      expected: master.length,
      actual: translated.length
    });
    const err = new Error('subtitle_lock_violation: translation_cue_count');
    err.code = 'SUBTITLE_LOCK_VIOLATION';
    throw err;
  }
  return master.map((cue, i) => {
    const tr = translated[i];
    const next = {
      ...cue,
      text: String(tr?.text || cue.text).trim() || cue.text
    };
    assertLockedCueImmutable(cue, next, 'translation');
    return next;
  });
}

/**
 * Compare Master Clean SRT vs final ASS dialogues before MP4 render.
 */
export function validateMasterVsAss(masterCues, assDialogues, opts = {}) {
  const toleranceMs = Number(opts.toleranceMs ?? TIMING_TOLERANCE_MS);
  const master = Array.isArray(masterCues) ? masterCues : [];
  const ass = Array.isArray(assDialogues) ? assDialogues : [];
  const reasons = [];

  if (master.length !== ass.length) {
    reasons.push(`cue_count mismatch master=${master.length} ass=${ass.length}`);
  }

  const n = Math.min(master.length, ass.length);
  for (let i = 0; i < n; i++) {
    const m = master[i];
    const a = ass[i];
    const mStart = Number(m.start);
    const mEnd = Number(m.end);
    const aStart = Number(a.assStart ?? a.start);
    const aEnd = Number(a.assEnd ?? a.end);
    if (Math.abs(roundMs(mStart) - roundMs(aStart)) > toleranceMs) {
      reasons.push(`cue[${i}] start drift master=${mStart} ass=${aStart}`);
    }
    if (Math.abs(roundMs(mEnd) - roundMs(aEnd)) > toleranceMs) {
      reasons.push(`cue[${i}] end drift master=${mEnd} ass=${aEnd}`);
    }
    if (m.id && a.id && m.id !== a.id) {
      reasons.push(`cue[${i}] id mismatch master=${m.id} ass=${a.id}`);
    }
  }

  if (ass.length > master.length) {
    reasons.push(`ass has ${ass.length - master.length} extra cue(s)`);
  }
  if (master.length > ass.length) {
    reasons.push(`ass missing ${master.length - ass.length} cue(s)`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    masterCount: master.length,
    assCount: ass.length
  };
}

export function assertMasterAssSyncOrThrow(masterCues, assDialogues, ctx = {}) {
  const result = validateMasterVsAss(masterCues, assDialogues, ctx);
  if (!result.ok) {
    logSubtitleSyncValidationFailed({ ...ctx, ...result });
    const err = new Error(`SUBTITLE_SYNC_VALIDATION_FAILED: ${result.reasons.slice(0, 6).join('; ')}`);
    err.code = 'SUBTITLE_SYNC_VALIDATION_FAILED';
    err.validation = result;
    throw err;
  }
  logSubtitleSyncValidationPassed({
    ...ctx,
    cueCount: result.masterCount
  });
  return result;
}
