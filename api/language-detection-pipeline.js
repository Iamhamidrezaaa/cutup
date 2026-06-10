/**
 * Language detection pipeline — accent-safe, multi-provider verification.
 */
import {
  analyzeTranscriptLanguage,
  resolveSpokenLanguage
} from './transcript-language-analysis.js';
import { normalizeLanguageCode, isSupportedLanguageCode } from './supported-languages.js';
import { sliceAudioFirstSeconds } from './transcription/audio-language-sample.js';
import { detectLanguageParallelVerification } from './transcription/language-detect-providers.js';

export const VERIFICATION_CONFIDENCE_THRESHOLD = 0.85;
const RTL_SUSPICIOUS_LANGS = new Set(['ru', 'ar', 'fa', 'he']);
const LATIN_SUSPICIOUS_RATIO = 0.6;

function logLanguageEvent(event, payload) {
  console.log(`[${event}]`, JSON.stringify(payload));
}

function latinLetterRatio(text, segments = []) {
  const corpus = [String(text || ''), ...(segments || []).map((s) => String(s?.text || ''))]
    .join(' ')
    .trim();
  if (!corpus.length) return 0;
  const latin = (corpus.match(/[a-zA-Z]/g) || []).length;
  return latin / corpus.length;
}

function isSuspiciousRtlDetection(language, latinRatio) {
  const lang = normalizeLanguageCode(language);
  return RTL_SUSPICIOUS_LANGS.has(lang) && latinRatio > LATIN_SUSPICIOUS_RATIO;
}

/**
 * Infer accent separately from spoken language (never conflate accent with language).
 */
export function inferAccentProfile(providerLanguage, finalLanguage, analysis) {
  const provider = normalizeLanguageCode(providerLanguage);
  const final = normalizeLanguageCode(finalLanguage);

  if (!final || final === 'unknown') {
    return { accent: null, accentConfidence: 0 };
  }

  if (
    (provider === 'ru' || provider === 'uk' || provider === 'pl') &&
    final === 'en' &&
    analysis.latinRatio >= 0.5
  ) {
    const accentMap = { ru: 'russian', uk: 'ukrainian', pl: 'polish' };
    return {
      accent: accentMap[provider] || provider,
      accentConfidence: Number(Math.min(0.95, 0.62 + analysis.latinRatio * 0.35).toFixed(4))
    };
  }

  if (provider && provider !== final && final === 'en' && analysis.latinRatio >= 0.5) {
    return {
      accent: provider,
      accentConfidence: Number(Math.min(0.88, 0.55 + analysis.latinRatio * 0.3).toFixed(4))
    };
  }

  return { accent: null, accentConfidence: 0 };
}

/**
 * English must never be downgraded to another language solely because of accent.
 */
export function applyEnglishAccentProtection(candidateLanguage, providerLanguage, analysis) {
  const candidate = normalizeLanguageCode(candidateLanguage);
  const provider = normalizeLanguageCode(providerLanguage);
  const contentTop = normalizeLanguageCode(analysis.top);

  const englishDominant =
    contentTop === 'en' ||
    analysis.latinRatio >= 0.55 ||
    (analysis.densities?.enWordDensity || 0) >= 0.04;

  if (!englishDominant) return candidate;

  const accentMislabels = new Set(['ru', 'uk', 'pl', 'ar', 'fa', 'he', 'hi', 'tr']);
  if (accentMislabels.has(candidate) && analysis.cyrillicRatio < 0.1 && analysis.arabicScriptRatio < 0.15) {
    return 'en';
  }

  if (provider === 'en' && accentMislabels.has(candidate)) {
    return 'en';
  }

  return candidate;
}

export function majorityLanguageVote(votes) {
  const valid = (votes || []).filter((v) => v?.language && v.language !== 'unknown');
  if (!valid.length) return { language: 'unknown', providerAgreement: 0, votes: [] };

  const counts = {};
  for (const v of valid) {
    counts[v.language] = (counts[v.language] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const winner = ranked[0][0];
  const agreement = ranked[0][1] / valid.length;
  return {
    language: winner,
    providerAgreement: Number(agreement.toFixed(4)),
    votes: valid
  };
}

function computeConsistencyScore({ finalLanguage, analysis, providerLanguage, providerAgreement }) {
  const lang = normalizeLanguageCode(finalLanguage);
  const contentTop = normalizeLanguageCode(analysis.top);
  const contentMatch = contentTop === lang ? 1 : contentTop === 'unknown' ? 0.5 : 0.25;
  const scriptMatch =
    lang === 'en' || ['fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'ro', 'id', 'vi', 'sv'].includes(lang)
      ? Math.min(1, analysis.latinRatio * 1.4)
      : lang === 'ru' || lang === 'uk'
        ? Math.min(1, analysis.cyrillicRatio * 1.6)
        : lang === 'fa' || lang === 'ar' || lang === 'he' || lang === 'ur'
          ? Math.min(1, analysis.arabicScriptRatio * 1.6)
          : 0.6;

  const providerMatch =
    normalizeLanguageCode(providerLanguage) === lang
      ? 1
      : normalizeLanguageCode(providerLanguage) === 'unknown'
        ? 0.5
        : 0.2;

  const wordDensity = Number(analysis.densities?.[`${lang}WordDensity`] || analysis.scores?.[lang] || 0);
  const wordScore = Math.min(1, wordDensity * 8);

  const raw =
    contentMatch * 0.3 +
    scriptMatch * 0.25 +
    providerMatch * 0.15 +
    wordScore * 0.1 +
    (providerAgreement || 0) * 0.2;

  return Number(Math.min(0.99, Math.max(0.35, raw)).toFixed(4));
}

/**
 * Sync transcript-only resolution (translate-srt, no audio).
 */
export function resolveLanguageFromTranscript(whisperLanguage, text, segments = [], opts = {}) {
  const providerLanguage = normalizeLanguageCode(opts.providerLanguage || whisperLanguage);
  const providerConfidence = Number(opts.providerConfidence ?? 0.72);
  const analysis = analyzeTranscriptLanguage(text, segments);
  const resolved = resolveSpokenLanguage(providerLanguage || whisperLanguage, text, segments);

  let language = applyEnglishAccentProtection(
    resolved.detectedLanguage,
    providerLanguage || whisperLanguage,
    analysis
  );
  if (!isSupportedLanguageCode(language)) language = 'unknown';

  const latinRatio = latinLetterRatio(text, segments);
  let verificationTriggered = false;
  let verificationApplied = false;

  if (
    providerConfidence < VERIFICATION_CONFIDENCE_THRESHOLD ||
    isSuspiciousRtlDetection(language, latinRatio)
  ) {
    verificationTriggered = true;
    const contentOverride = applyEnglishAccentProtection(analysis.top, providerLanguage, analysis);
    if (contentOverride !== language) {
      logLanguageEvent('language_override_applied', {
        traceId: opts.traceId || null,
        from: language,
        to: contentOverride,
        reason: 'transcript_content_verification'
      });
      language = contentOverride;
      verificationApplied = true;
    }
  }

  const { accent, accentConfidence } = inferAccentProfile(
    providerLanguage || whisperLanguage,
    language,
    analysis
  );

  const providerAgreement = verificationApplied ? 0.67 : providerLanguage === language ? 1 : 0.5;
  const languageConfidence = computeConsistencyScore({
    finalLanguage: language,
    analysis,
    providerLanguage,
    providerAgreement
  });

  if (providerLanguage !== language) {
    logLanguageEvent('language_detection_mismatch', {
      traceId: opts.traceId || null,
      providerLanguage,
      resolvedLanguage: language,
      providerConfidence,
      latinRatio,
      resolution: resolved.resolution
    });
  }

  return buildLanguageProfile({
    language,
    languageConfidence,
    accent,
    accentConfidence,
    providerAgreement,
    providerLanguage,
    analysis,
    resolved,
    verificationTriggered,
    verificationApplied
  });
}

/**
 * Full async pipeline with multi-provider verification on audio sample.
 */
export async function resolvePipelineLanguage(opts) {
  const {
    traceId = null,
    fetch,
    providerLanguage,
    providerConfidence,
    providerId = null,
    text = '',
    segments = [],
    audioBuffer = null,
    mimeType = 'audio/mpeg',
    extension = 'mp3'
  } = opts;

  const providerLang = normalizeLanguageCode(providerLanguage);
  const providerConf = Number.isFinite(Number(providerConfidence))
    ? Number(providerConfidence)
    : 0.72;

  const analysis = analyzeTranscriptLanguage(text, segments);
  const resolved = resolveSpokenLanguage(providerLang, text, segments);

  let language = applyEnglishAccentProtection(resolved.detectedLanguage, providerLang, analysis);
  let languageConfidence = Math.max(providerConf, resolved.confidence || 0);
  let providerAgreement = providerLang === language ? 1 : 0.55;
  let verificationTriggered = false;
  let verificationApplied = false;
  let verificationVotes = [];

  const latinRatio = latinLetterRatio(text, segments);
  const needsVerification =
    languageConfidence < VERIFICATION_CONFIDENCE_THRESHOLD ||
    isSuspiciousRtlDetection(language, latinRatio) ||
    (providerLang !== language && providerLang !== 'unknown');

  if (needsVerification) {
    verificationTriggered = true;
    logLanguageEvent('language_verification_triggered', {
      traceId,
      providerLanguage: providerLang,
      initialLanguage: language,
      providerConfidence: providerConf,
      latinRatio,
      providerId
    });

    if (fetch && audioBuffer && Buffer.isBuffer(audioBuffer) && audioBuffer.length > 0) {
      try {
        const sample = await sliceAudioFirstSeconds(audioBuffer, mimeType, extension, 15);
        verificationVotes = await detectLanguageParallelVerification({
          fetch,
          audioBuffer: sample.buffer,
          mimeType: sample.mimeType,
          extension: sample.extension,
          traceId
        });
        const vote = majorityLanguageVote(verificationVotes);
        if (vote.language && vote.language !== 'unknown') {
          const protectedLang = applyEnglishAccentProtection(vote.language, providerLang, analysis);
          if (protectedLang !== language) {
            logLanguageEvent('language_override_applied', {
              traceId,
              from: language,
              to: protectedLang,
              reason: 'multi_provider_majority_vote',
              votes: verificationVotes.map((v) => ({ provider: v.provider, language: v.language }))
            });
            verificationApplied = true;
          }
          language = protectedLang;
          providerAgreement = vote.providerAgreement;
          languageConfidence = Math.max(
            languageConfidence,
            computeConsistencyScore({
              finalLanguage: language,
              analysis,
              providerLanguage: providerLang,
              providerAgreement
            })
          );
        }
      } catch (verifyErr) {
        console.warn('[language_verification_failed]', {
          traceId,
          message: verifyErr?.message || String(verifyErr)
        });
      }
    }

    if (!verificationApplied) {
      const contentOverride = applyEnglishAccentProtection(analysis.top, providerLang, analysis);
      if (contentOverride !== language) {
        logLanguageEvent('language_override_applied', {
          traceId,
          from: language,
          to: contentOverride,
          reason: 'transcript_content_fallback'
        });
        language = contentOverride;
        verificationApplied = true;
      }
    }
  }

  if (!isSupportedLanguageCode(language)) {
    language = isSupportedLanguageCode(analysis.top) ? analysis.top : providerLang || 'unknown';
  }

  languageConfidence = computeConsistencyScore({
    finalLanguage: language,
    analysis,
    providerLanguage: providerLang,
    providerAgreement
  });

  const { accent, accentConfidence } = inferAccentProfile(providerLang, language, analysis);

  if (providerLang && providerLang !== language) {
    logLanguageEvent('language_detection_mismatch', {
      traceId,
      providerLanguage: providerLang,
      resolvedLanguage: language,
      providerConfidence: providerConf,
      accent,
      accentConfidence,
      latinRatio,
      providerId,
      verificationTriggered,
      verificationApplied
    });
  }

  return buildLanguageProfile({
    language,
    languageConfidence,
    accent,
    accentConfidence,
    providerAgreement,
    providerLanguage: providerLang,
    analysis,
    resolved,
    verificationTriggered,
    verificationApplied,
    verificationVotes
  });
}

/** API-facing language detection payload (backward-compatible fields included). */
export function formatLanguageDetectionForApi(profile) {
  const resolvedLanguage = profile?.language || 'unknown';
  return {
    detectedLanguage: resolvedLanguage,
    language: profile.language,
    languageConfidence: profile.languageConfidence,
    accent: profile.accent ?? null,
    accentConfidence: profile.accentConfidence ?? 0,
    providerAgreement: profile.providerAgreement ?? 0,
    whisperLanguage: profile.whisperLanguage ?? profile.providerLanguage ?? null,
    confidence: profile.languageConfidence,
    detectedBy: profile.detectedBy,
    needsReview: profile.needsReview,
    transcriptSample: profile.transcriptSample,
    providerLanguage: profile.providerLanguage,
    verificationTriggered: profile.verificationTriggered,
    verificationApplied: profile.verificationApplied,
    verificationVotes: profile.verificationVotes
  };
}

function buildLanguageProfile({
  language,
  languageConfidence,
  accent,
  accentConfidence,
  providerAgreement,
  providerLanguage,
  analysis,
  resolved,
  verificationTriggered,
  verificationApplied,
  verificationVotes = []
}) {
  return {
    language,
    languageConfidence: Number(languageConfidence.toFixed(4)),
    accent: accent || null,
    accentConfidence: Number((accentConfidence || 0).toFixed(4)),
    providerAgreement: Number((providerAgreement || 0).toFixed(4)),
    detectedLanguage: language,
    confidence: Number(languageConfidence.toFixed(4)),
    detectedBy: resolved.resolution || 'pipeline',
    needsReview: languageConfidence < VERIFICATION_CONFIDENCE_THRESHOLD,
    transcriptSample: resolved.transcriptSample,
    whisperLanguage: providerLanguage,
    providerLanguage,
    verificationTriggered,
    verificationApplied,
    verificationVotes: verificationVotes.map((v) => ({
      provider: v.provider,
      language: v.language,
      confidence: v.confidence
    })),
    analysis: {
      top: analysis.top,
      latinRatio: analysis.latinRatio,
      cyrillicRatio: analysis.cyrillicRatio,
      arabicScriptRatio: analysis.arabicScriptRatio,
      ranked: analysis.ranked
    }
  };
}
