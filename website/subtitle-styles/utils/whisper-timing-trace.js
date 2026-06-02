/**
 * Client-side Whisper / segment timing trace (read-only snapshots).
 */
(function (global) {
  'use strict';

  const MAX = 10;

  function roundSec(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
  }

  function snapshotSegments(segments, stage) {
    return (Array.isArray(segments) ? segments : []).slice(0, MAX).map((s, segmentIndex) => {
      const words = Array.isArray(s.words) ? s.words : [];
      const first = words.find((w) => Number.isFinite(Number(w?.start))) || words[0];
      return {
        segmentIndex,
        stage,
        segmentStartRawFromWhisper: roundSec(s.start),
        segmentEndRawFromWhisper: roundSec(s.end),
        firstWordStartRaw: first != null ? roundSec(first.start) : null,
        firstWordEndRaw: first != null ? roundSec(first.end) : null,
        wordCount: words.length,
        textPreview: String(s.text || '').slice(0, 80)
      };
    });
  }

  function ensureStore() {
    if (!global.cutupWhisperTimingTrace) {
      global.cutupWhisperTimingTrace = { stages: [], pipelineNote: 'source video → audio → whisper API → client normalize → versions → export segments' };
    }
    return global.cutupWhisperTimingTrace;
  }

  function recordWhisperTimingStage(stage, segments, meta) {
    const store = ensureStore();
    store.stages.push({
      stage,
      capturedAt: Date.now(),
      meta: meta || null,
      segments: snapshotSegments(segments, stage)
    });
  }

  function resetWhisperTimingTrace() {
    global.cutupWhisperTimingTrace = { stages: [], pipelineNote: ensureStore().pipelineNote };
  }

  function getWhisperTimingTraceForExport() {
    return global.cutupWhisperTimingTrace || null;
  }

  global.CutupWhisperTimingTrace = {
    recordWhisperTimingStage,
    resetWhisperTimingTrace,
    getWhisperTimingTraceForExport,
    snapshotSegments
  };
})(typeof window !== 'undefined' ? window : globalThis);
