/**
 * Language detection pipeline — OpenAI-first, accent-safe verification.
 */
import {
  analyzeTranscriptLanguage,
  resolveSpokenLanguage
} from './transcript-language-analysis.js';
import { normalizeLanguageCode, isSupportedLanguageCode } from './supported-languages.js';
import { sliceAudioVerificationSamples } from './transcription/audio-language-sample.js';
import {
  detectLanguageOpenAiTripleSample,
  isOpenAiLanguageDetectionAvailable
} from './transcription/language-detect-providers.js';

export const VERIFICATION_CONFIDENCE_THRESHOLD = 0.85;
export const HIGH_CONFIDENCE_LATIN_BLOCK = 0.95;
export const MIN_SLAVIC_HINT_CONFIDENCE = 0.9;
export const MIN_SLAVIC_HINT_AGREEMENT = 0.999;
const RTL_SUSPICIOUS_LANGS = new Set(['ru', 'ar', 'fa', 'he']);
const LATIN_SUSPICIOUS_RATIO = 0.6;
/** Acoustic models often confuse these with accented English — never weak-hint Whisper. */
const ACCENT_SUSCEPTIBLE_HINT_LANGS = new Set(['ru', 'uk', 'pl', 'bg', 'sr', 'hr', 'sk', 'cs', 'be']);
const SLAVIC_TRANSCRIPT_LANGS = new Set(['ru', 'uk', 'pl']);

function logLanguageEvent(event, payload) {
  console.log(`[${event}]`, JSON.stringify(payload));
}

function logLanguageDetectionResult(payload) {
  logLanguageEvent('language_detection_result', {
    rawProviderLanguage: payload.rawProviderLanguage ?? null,
    finalLanguage: payload.finalLanguage ?? null,
    verificationTriggered: Boolean(payload.verificationTriggered),
    overrideApplied: Boolean(payload.overrideApplied),
    traceId: payload.traceId ?? null,
    languageConfidence: payload.languageConfidence ?? null,
    providerAgreement: payload.providerAgreement ?? null,
    accent: payload.accent ?? null,
    preTranscriptionLanguage: payload.preTranscriptionLanguage ?? null,
    latinRatio: payload.latinRatio ?? null
  });
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
 * Never classify as ru/ar/fa/he when transcript is >60% Latin unless confidence > 0.95.
 */
export function applyLatinScriptGuard(candidateLanguage, latinRatio, confidence, analysis = null) {
  const lang = normalizeLanguageCode(candidateLanguage);
  if (latinRatio <= LATIN_SUSPICIOUS_RATIO || !RTL_SUSPICIOUS_LANGS.has(lang)) {
    return { language: lang, overrideApplied: false };
  }
  if (Number(confidence) > HIGH_CONFIDENCE_LATIN_BLOCK) {
    return { language: lang, overrideApplied: false };
  }

  const englishDominant =
    analysis?.top === 'en' ||
    (analysis?.latinRatio ?? latinRatio) >= 0.55 ||
    (analysis?.densities?.enWordDensity || 0) >= 0.04;

  const fallback = englishDominant
    ? 'en'
    : isSupportedLanguageCode(analysis?.top)
      ? analysis.top
      : 'en';

  return {
    language: fallback,
    overrideApplied: true,
    reason: 'latin_script_guard'
  };
}

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

export function isStrongSlavicHintEvidence(preTranscription) {
  if (!preTranscription) return false;
  const lang = normalizeLanguageCode(preTranscription.language);
  if (!SLAVIC_TRANSCRIPT_LANGS.has(lang)) return false;
  const agreement = Number(preTranscription.providerAgreement ?? 0);
  const confidence = Number(preTranscription.languageConfidence ?? 0);
  const votes = Array.isArray(preTranscription.verificationVotes)
    ? preTranscription.verificationVotes
    : [];
  const unanimous =
    votes.length >= 2 &&
    votes.every((v) => normalizeLanguageCode(v.language) === lang);
  return (
    agreement >= MIN_SLAVIC_HINT_AGREEMENT &&
    confidence >= MIN_SLAVIC_HINT_CONFIDENCE &&
    (votes.length === 0 || unanimous)
  );
}

/**
 * Decide Whisper `language` param. Weak Slavic hints are suppressed (accent ≠ language).
 */
export function resolveTranscriptionLanguageHint(opts = {}) {
  const clientHintNorm = opts.clientHint ? normalizeLanguageCode(opts.clientHint) : null;
  const clientHint =
    clientHintNorm && clientHintNorm !== 'unknown' ? clientHintNorm : null;
  const pre = opts.preTranscription || null;
  const preLang = normalizeLanguageCode(pre?.language);
  const traceId = opts.traceId || null;

  function safeHint(lang, source, meta = {}, preTranscription = pre) {
    const strongSlavic = isStrongSlavicHintEvidence(preTranscription);
    if (!lang || lang === 'unknown') {
      return { languageHint: null, source: 'auto', suppressed: true, suspectedAccent: preLang || clientHint || null };
    }
    if (ACCENT_SUSCEPTIBLE_HINT_LANGS.has(lang) && !strongSlavic) {
      logLanguageEvent('transcription_language_hint_suppressed', {
        traceId,
        requestedLanguage: lang,
        source,
        reason: 'accent_susceptible_weak_evidence',
        providerAgreement: pre?.providerAgreement ?? null,
        languageConfidence: pre?.languageConfidence ?? null
      });
      return {
        languageHint: null,
        source: 'auto',
        suppressed: true,
        suspectedAccent: lang,
        ...meta
      };
    }
    return {
      languageHint: lang,
      source,
      suppressed: false,
      suspectedAccent: null,
      ...meta
    };
  }

  if (clientHint && !ACCENT_SUSCEPTIBLE_HINT_LANGS.has(clientHint)) {
    return safeHint(clientHint, 'client');
  }
  if (clientHint && ACCENT_SUSCEPTIBLE_HINT_LANGS.has(clientHint)) {
    logLanguageEvent('transcription_language_hint_suppressed', {
      traceId,
      requestedLanguage: clientHint,
      source: 'client_metadata',
      reason: 'accent_susceptible_client_hint_ignored'
    });
  }

  if (preLang && preLang !== 'unknown') {
    const hint = safeHint(
      preLang,
      'pre_transcription',
      {
        providerAgreement: pre?.providerAgreement ?? null,
        languageConfidence: pre?.languageConfidence ?? null
      },
      pre
    );
    return hint;
  }

  return { languageHint: null, source: 'auto', suppressed: true, suspectedAccent: null };
}

export function shouldAttemptAccentEnglishRetranscribe(transcript, hintResolution = {}, preTranscription = null) {
  const providerLang = normalizeLanguageCode(transcript?.language);
  if (!SLAVIC_TRANSCRIPT_LANGS.has(providerLang)) return false;

  const analysis = analyzeTranscriptLanguage(transcript?.text, transcript?.segments || []);
  if (analysis.cyrillicRatio < 0.2) return false;

  if (isStrongSlavicHintEvidence(preTranscription || hintResolution)) {
    return analysis.latinRatio > 0.12;
  }

  return true;
}

export function pickAccentRetranscribeWinner(originalTranscript, englishRetryTranscript, preTranscription = null) {
  const originalLang = normalizeLanguageCode(originalTranscript?.language);
  const originalAnalysis = analyzeTranscriptLanguage(
    originalTranscript?.text,
    originalTranscript?.segments || []
  );
  const retryAnalysis = analyzeTranscriptLanguage(
    englishRetryTranscript?.text,
    englishRetryTranscript?.segments || []
  );

  const retryLooksEnglish =
    retryAnalysis.latinRatio >= 0.42 &&
    retryAnalysis.cyrillicRatio < 0.15 &&
    String(englishRetryTranscript?.text || '').trim().length > 8;

  const originalLooksAuthenticRussian =
    isStrongSlavicHintEvidence(preTranscription) &&
    originalAnalysis.cyrillicRatio >= 0.45 &&
    originalAnalysis.latinRatio < 0.08 &&
    !retryLooksEnglish;

  if (originalLooksAuthenticRussian) {
    return {
      usedRetry: false,
      transcript: originalTranscript,
      fromLanguage: originalLang,
      reason: 'authentic_russian_retained'
    };
  }

  if (retryLooksEnglish) {
    return {
      usedRetry: true,
      transcript: {
        ...englishRetryTranscript,
        language: 'en',
        accentRetranscribeApplied: true,
        priorMisdetectedLanguage: originalLang
      },
      fromLanguage: originalLang,
      reason: 'accent_english_retranscribe'
    };
  }

  return {
    usedRetry: false,
    transcript: originalTranscript,
    fromLanguage: originalLang,
    reason: 'retry_not_better'
  };
}

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

function averageVoteConfidence(votes) {
  const confs = (votes || []).map((v) => Number(v.confidence)).filter(Number.isFinite);
  if (!confs.length) return 0.72;
  return Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(4));
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
 * Pre-transcription OpenAI verification: first / middle / last 15s majority vote.
 */
export async function runPreTranscriptionLanguageDetection(opts) {
  const { traceId = null, fetch, audioBuffer, mimeType = 'audio/mpeg', extension = 'mp3' } = opts;

  if (!fetch || !audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    return {
      language: null,
      languageConfidence: 0,
      providerAgreement: 0,
      verificationVotes: [],
      verificationTriggered: false
    };
  }

  if (!isOpenAiLanguageDetectionAvailable()) {
    return {
      language: null,
      languageConfidence: 0,
      providerAgreement: 0,
      verificationVotes: [],
      verificationTriggered: false
    };
  }

  const samples = await sliceAudioVerificationSamples(audioBuffer, mimeType, extension, 15);
  const verificationVotes = await detectLanguageOpenAiTripleSample({ fetch, samples, traceId });
  const vote = majorityLanguageVote(verificationVotes);
  const languageConfidence = averageVoteConfidence(verificationVotes);

  logLanguageEvent('language_verification_triggered', {
    traceId,
    phase: 'pre_transcription',
    strategy: 'openai_triple_sample',
    votes: verificationVotes.map((v) => ({
      position: v.position,
      language: v.language,
      confidence: v.confidence
    })),
    majorityLanguage: vote.language,
    providerAgreement: vote.providerAgreement
  });

  return {
    language: vote.language !== 'unknown' ? vote.language : null,
    languageConfidence,
    providerAgreement: vote.providerAgreement,
    verificationVotes,
    verificationTriggered: true
  };
}

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

  const latinRatio = latinLetterRatio(text, segments);
  let overrideApplied = false;
  let verificationTriggered = false;

  const latinGuard = applyLatinScriptGuard(language, latinRatio, providerConfidence, analysis);
  if (latinGuard.overrideApplied) {
    overrideApplied = true;
    language = latinGuard.language;
    logLanguageEvent('language_override_applied', {
      traceId: opts.traceId || null,
      from: resolved.detectedLanguage,
      to: language,
      reason: latinGuard.reason
    });
  }

  if (
    providerConfidence < VERIFICATION_CONFIDENCE_THRESHOLD ||
    isSuspiciousRtlDetection(language, latinRatio)
  ) {
    verificationTriggered = true;
    const contentOverride = applyEnglishAccentProtection(analysis.top, providerLanguage, analysis);
    const guarded = applyLatinScriptGuard(contentOverride, latinRatio, providerConfidence, analysis);
    if (guarded.language !== language) {
      logLanguageEvent('language_override_applied', {
        traceId: opts.traceId || null,
        from: language,
        to: guarded.language,
        reason: 'transcript_content_verification'
      });
      language = guarded.language;
      overrideApplied = true;
    }
  }

  if (!isSupportedLanguageCode(language)) language = 'unknown';

  const { accent, accentConfidence } = inferAccentProfile(
    providerLanguage || whisperLanguage,
    language,
    analysis
  );

  const providerAgreement = overrideApplied ? 0.67 : providerLanguage === language ? 1 : 0.5;
  const languageConfidence = computeConsistencyScore({
    finalLanguage: language,
    analysis,
    providerLanguage,
    providerAgreement
  });

  if (providerLanguage !== language) {
    logLanguageEvent('language_detection_mismatch', {
      traceId: opts.traceId || null,
      rawProviderLanguage: providerLanguage,
      finalLanguage: language,
      providerConfidence,
      latinRatio,
      resolution: resolved.resolution
    });
  }

  logLanguageDetectionResult({
    traceId: opts.traceId || null,
    rawProviderLanguage: providerLanguage,
    finalLanguage: language,
    verificationTriggered,
    overrideApplied,
    languageConfidence,
    providerAgreement,
    accent,
    latinRatio
  });

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
    overrideApplied,
    verificationVotes: [],
    preTranscription: null
  });
}

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
    extension = 'mp3',
    preTranscription = null
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
  let verificationTriggered = Boolean(preTranscription?.verificationTriggered);
  let overrideApplied = false;
  let verificationVotes = preTranscription?.verificationVotes || [];

  const latinRatio = latinLetterRatio(text, segments);

  const latinGuardInitial = applyLatinScriptGuard(language, latinRatio, languageConfidence, analysis);
  if (latinGuardInitial.overrideApplied) {
    overrideApplied = true;
    language = latinGuardInitial.language;
    logLanguageEvent('language_override_applied', {
      traceId,
      from: resolved.detectedLanguage,
      to: language,
      reason: latinGuardInitial.reason
    });
  }

  const preLang = normalizeLanguageCode(preTranscription?.language);
  if (preLang && preLang !== 'unknown') {
    const guardedPre = applyLatinScriptGuard(
      applyEnglishAccentProtection(preLang, providerLang, analysis),
      latinRatio,
      preTranscription.languageConfidence || languageConfidence,
      analysis
    );
    if (
      providerConf < VERIFICATION_CONFIDENCE_THRESHOLD ||
      providerLang !== guardedPre.language ||
      isSuspiciousRtlDetection(language, latinRatio)
    ) {
      verificationTriggered = true;
      if (guardedPre.language !== language) {
        logLanguageEvent('language_override_applied', {
          traceId,
          from: language,
          to: guardedPre.language,
          reason: 'pre_transcription_majority_vote',
          votes: verificationVotes.map((v) => ({ position: v.position, language: v.language }))
        });
        overrideApplied = true;
      }
      language = guardedPre.language;
      providerAgreement = preTranscription.providerAgreement ?? providerAgreement;
      languageConfidence = Math.max(
        languageConfidence,
        preTranscription.languageConfidence || 0,
        computeConsistencyScore({
          finalLanguage: language,
          analysis,
          providerLanguage: providerLang,
          providerAgreement
        })
      );
    }
  }

  const needsPostVerification =
    languageConfidence < VERIFICATION_CONFIDENCE_THRESHOLD ||
    isSuspiciousRtlDetection(language, latinRatio) ||
    (providerLang !== language && providerLang !== 'unknown');

  if (needsPostVerification && (!preLang || preLang === 'unknown')) {
    verificationTriggered = true;
    logLanguageEvent('language_verification_triggered', {
      traceId,
      phase: 'post_transcription',
      strategy: 'openai_triple_sample',
      providerLanguage: providerLang,
      initialLanguage: language,
      providerConfidence: providerConf,
      latinRatio,
      providerId
    });

    if (fetch && audioBuffer && Buffer.isBuffer(audioBuffer) && audioBuffer.length > 0) {
      try {
        const samples = await sliceAudioVerificationSamples(audioBuffer, mimeType, extension, 15);
        verificationVotes = await detectLanguageOpenAiTripleSample({ fetch, samples, traceId });
        const vote = majorityLanguageVote(verificationVotes);
        if (vote.language && vote.language !== 'unknown') {
          const protectedLang = applyEnglishAccentProtection(vote.language, providerLang, analysis);
          const guarded = applyLatinScriptGuard(
            protectedLang,
            latinRatio,
            averageVoteConfidence(verificationVotes),
            analysis
          );
          if (guarded.language !== language) {
            logLanguageEvent('language_override_applied', {
              traceId,
              from: language,
              to: guarded.language,
              reason: 'post_transcription_triple_sample_vote',
              votes: verificationVotes.map((v) => ({ position: v.position, language: v.language }))
            });
            overrideApplied = true;
          }
          language = guarded.language;
          providerAgreement = vote.providerAgreement;
          languageConfidence = Math.max(
            languageConfidence,
            averageVoteConfidence(verificationVotes),
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

    if (!overrideApplied) {
      const contentOverride = applyEnglishAccentProtection(analysis.top, providerLang, analysis);
      const guarded = applyLatinScriptGuard(contentOverride, latinRatio, languageConfidence, analysis);
      if (guarded.language !== language) {
        logLanguageEvent('language_override_applied', {
          traceId,
          from: language,
          to: guarded.language,
          reason: 'transcript_content_fallback'
        });
        language = guarded.language;
        overrideApplied = true;
      }
    }
  }

  const latinGuardFinal = applyLatinScriptGuard(language, latinRatio, languageConfidence, analysis);
  if (latinGuardFinal.overrideApplied && latinGuardFinal.language !== language) {
    overrideApplied = true;
    logLanguageEvent('language_override_applied', {
      traceId,
      from: language,
      to: latinGuardFinal.language,
      reason: latinGuardFinal.reason
    });
    language = latinGuardFinal.language;
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
      rawProviderLanguage: providerLang,
      finalLanguage: language,
      providerConfidence: providerConf,
      accent,
      accentConfidence,
      latinRatio,
      providerId,
      verificationTriggered,
      overrideApplied
    });
  }

  logLanguageDetectionResult({
    traceId,
    rawProviderLanguage: providerLang,
    finalLanguage: language,
    verificationTriggered,
    overrideApplied,
    languageConfidence,
    providerAgreement,
    accent,
    preTranscriptionLanguage: preLang || null,
    latinRatio
  });

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
    overrideApplied,
    verificationVotes,
    preTranscription
  });
}

export function formatLanguageDetectionForApi(profile) {
  const resolvedLanguage = profile?.language || 'unknown';
  const sampleVotes = (profile?.verificationVotes || []).map((v) => ({
    position: v.position || null,
    provider: v.provider,
    language: v.language,
    confidence: v.confidence
  }));
  const firstVote = sampleVotes.find((v) => v.position === 'first');
  const middleVote = sampleVotes.find((v) => v.position === 'middle');
  const lastVote = sampleVotes.find((v) => v.position === 'last');

  return {
    detectedLanguage: resolvedLanguage,
    language: profile.language,
    languageConfidence: profile.languageConfidence,
    accent: profile.accent ?? null,
    accentConfidence: profile.accentConfidence ?? 0,
    providerAgreement: profile.providerAgreement ?? 0,
    rawProviderLanguage: profile.providerLanguage ?? profile.whisperLanguage ?? null,
    providerLanguage: profile.providerLanguage,
    whisperLanguage: profile.whisperLanguage ?? profile.providerLanguage ?? null,
    confidence: profile.languageConfidence,
    detectedBy: profile.detectedBy,
    needsReview: profile.needsReview,
    transcriptSample: profile.transcriptSample,
    verificationTriggered: profile.verificationTriggered,
    overrideApplied: profile.overrideApplied,
    verificationApplied: profile.overrideApplied,
    verificationVotes: sampleVotes,
    preTranscriptionLanguage: profile.preTranscription?.language ?? null,
    sampleVotes: {
      first: firstVote?.language ?? null,
      middle: middleVote?.language ?? null,
      last: lastVote?.language ?? null
    }
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
  overrideApplied,
  verificationVotes = [],
  preTranscription = null
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
    overrideApplied,
    verificationApplied: overrideApplied,
    verificationVotes: verificationVotes.map((v) => ({
      provider: v.provider,
      language: v.language,
      confidence: v.confidence,
      position: v.position || null
    })),
    preTranscription,
    analysis: {
      top: analysis.top,
      latinRatio: analysis.latinRatio,
      cyrillicRatio: analysis.cyrillicRatio,
      arabicScriptRatio: analysis.arabicScriptRatio,
      ranked: analysis.ranked
    }
  };
}
