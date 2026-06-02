/**
 * Segment start-time lineage helpers (read-only forensic).
 */

const DEFAULT_MAX = 10;

/** @type {{ functionName: string, segments: object[] }[]|null} */
let _lineageCapture = null;

export function beginSegmentTimingLineageCapture() {
  _lineageCapture = [];
}

export function isSegmentTimingLineageCaptureActive() {
  return _lineageCapture !== null;
}

export function recordSegmentTimingStage(functionName, segments) {
  if (!_lineageCapture) return;
  _lineageCapture.push({
    functionName,
    capturedAt: Date.now(),
    segments: buildSegmentTimingSnapshot(segments)
  });
}

export function endSegmentTimingLineageCapture() {
  const out = _lineageCapture ? [..._lineageCapture] : [];
  _lineageCapture = null;
  return out;
}

export function roundTimingSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

export function timingDeltaMs(fromSec, toSec) {
  if (fromSec == null || toSec == null) return null;
  return Math.round((Number(toSec) - Number(fromSec)) * 1000);
}

export function buildSegmentTimingSnapshot(segments, max = DEFAULT_MAX) {
  return (Array.isArray(segments) ? segments : []).slice(0, max).map((s, segmentIndex) => {
    const words = Array.isArray(s.words) ? s.words : [];
    const firstTimed = words.find((w) => Number.isFinite(Number(w?.start)));
    const first = firstTimed || words[0];
    const lastTimed = [...words].reverse().find((w) => Number.isFinite(Number(w?.end)));
    return {
      segmentIndex,
      start: roundTimingSec(s?.start),
      end: roundTimingSec(s?.end),
      firstWordStart: first != null ? roundTimingSec(first.start) : null,
      firstWordEnd: first != null ? roundTimingSec(first.end) : null,
      lastWordEnd: lastTimed != null ? roundTimingSec(lastTimed.end) : null,
      wordCount: words.length,
      textPreview: String(s?.text || '').slice(0, 60)
    };
  });
}

/**
 * Compare ordered stages; emit change log when start at index changes.
 * @param {{ functionName: string, segments: object[] }[]} stageSnapshots
 */
export function buildTimingChangeLog(stageSnapshots) {
  const changes = [];
  if (!stageSnapshots?.length) return changes;

  const byIndex = new Map();
  for (const stage of stageSnapshots) {
    const fn = stage.functionName || stage.stage || 'unknown';
    for (const row of stage.segments || []) {
      const i = row.segmentIndex;
      if (!byIndex.has(i)) byIndex.set(i, []);
      byIndex.get(i).push({ functionName: fn, start: row.start });
    }
  }

  for (const [segmentIndex, chain] of byIndex.entries()) {
    let prev = null;
    let prevFn = null;
    for (const step of chain) {
      if (step.start == null) continue;
      if (prev != null && step.start !== prev) {
        changes.push({
          segmentIndex,
          functionName: step.functionName,
          previousStage: prevFn,
          previousValue: prev,
          newValue: step.start,
          deltaMs: timingDeltaMs(prev, step.start)
        });
      }
      prev = step.start;
      prevFn = step.functionName;
    }
  }

  return changes;
}

/**
 * First timestamp change in segment 0 chain (not "Whisper blame").
 */
export function findFirstSegmentZeroChange(stageSnapshots) {
  const changes = buildTimingChangeLog(stageSnapshots).filter((c) => c.segmentIndex === 0);
  const first = changes[0] || null;
  const seg0Starts = [];
  for (const stage of stageSnapshots || []) {
    const row = (stage.segments || []).find((r) => r.segmentIndex === 0);
    if (row?.start != null) {
      seg0Starts.push({
        functionName: stage.functionName || stage.stage,
        start: row.start
      });
    }
  }
  const baseline = seg0Starts[0]?.start ?? null;
  return {
    baselineStart: baseline,
    firstChange: first,
    allSegment0Starts: seg0Starts,
    introducedAtFunction: first ? first.functionName : null,
    introducedDelayMs: first ? first.deltaMs : 0,
    note: first
      ? `First start change on segment 0 at ${first.functionName} (${first.previousValue}s → ${first.newValue}s).`
      : baseline != null
        ? `No start change on segment 0 across captured stages; start remains ${baseline}s from first snapshot.`
        : 'No segment 0 timing data captured.'
  };
}
