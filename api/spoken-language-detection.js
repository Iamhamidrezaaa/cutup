/**
 * Spoken-language resolution from transcript content (accent-safe).
 * Re-exports analysis helpers and pipeline-backed confidence builder.
 */
export { analyzeTranscriptLanguage, resolveSpokenLanguage } from './transcript-language-analysis.js';
export { resolveLanguageFromTranscript as buildLanguageConfidence } from './language-detection-pipeline.js';
