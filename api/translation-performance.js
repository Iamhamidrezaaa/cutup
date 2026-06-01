/**
 * Translation pipeline performance telemetry (measurement only).
 */

const WARN_THRESHOLD_MS = Number(process.env.TRANSLATION_PERFORMANCE_WARN_MS || 5000);

const STAGE_KEYS = [
  'languageDetectionMs',
  'translationMs',
  'qualityScoreMs',
  'rewriteMs',
  'adaptiveEngineMs',
  'backTranslationMs',
  'fluencyPassMs',
  'domainRewriteMs',
  'trainingDataMs'
];

/**
 * @param {string} traceId
 * @param {number} cueCount
 */
export function createTranslationPerformanceTracker(traceId, cueCount) {
  const stages = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0]));
  const pipelineStart = performance.now();

  return {
    traceId,
    cueCount: Number(cueCount) || 0,
    stages,

    add(stageKey, durationMs) {
      if (!STAGE_KEYS.includes(stageKey)) return;
      stages[stageKey] += Math.max(0, Math.round(Number(durationMs) || 0));
    },

    timeSync(stageKey, fn) {
      const start = performance.now();
      try {
        return fn();
      } finally {
        this.add(stageKey, performance.now() - start);
      }
    },

    async timeAsync(stageKey, fn) {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        this.add(stageKey, performance.now() - start);
      }
    },

    finish(extra = {}) {
      const totalPipelineMs = Math.round(performance.now() - pipelineStart);
      let slowestStage = STAGE_KEYS[0];
      let slowestStageDurationMs = stages[slowestStage] || 0;

      for (const key of STAGE_KEYS) {
        if ((stages[key] || 0) > slowestStageDurationMs) {
          slowestStage = key;
          slowestStageDurationMs = stages[key];
        }
      }

      const payload = {
        traceId,
        cueCount: this.cueCount,
        languageDetectionMs: stages.languageDetectionMs,
        translationMs: stages.translationMs,
        qualityScoreMs: stages.qualityScoreMs,
        rewriteMs: stages.rewriteMs,
        adaptiveEngineMs: stages.adaptiveEngineMs,
        backTranslationMs: stages.backTranslationMs,
        fluencyPassMs: stages.fluencyPassMs,
        domainRewriteMs: stages.domainRewriteMs,
        trainingDataMs: stages.trainingDataMs,
        totalPipelineMs,
        slowestStage,
        slowestStageDurationMs,
        ...extra
      };

      console.log('[translation-performance]', JSON.stringify(payload));

      for (const key of STAGE_KEYS) {
        const ms = stages[key] || 0;
        if (ms > WARN_THRESHOLD_MS) {
          console.warn(
            '[translation-performance-warning]',
            JSON.stringify({
              traceId,
              stage: key,
              durationMs: ms,
              thresholdMs: WARN_THRESHOLD_MS,
              cueCount: this.cueCount
            })
          );
        }
      }

      return payload;
    }
  };
}

export function isTranslationPerformanceEnabled() {
  return String(process.env.TRANSLATION_PERFORMANCE ?? '1') !== '0';
}
