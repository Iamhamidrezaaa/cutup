// API endpoint for translating SRT subtitle files (GPT). Production validation — no silent English fallback.

import { handleCORS, setCORSHeaders } from './cors.js';
import OpenAI from 'openai';
import {
  requireSessionEmail,
  billingMinutesFromSrtSegments,
  consumeSrtUsage
} from './processing-enforcement.js';
import { canUseFeature } from './subscription.js';
import { resolveTraceId, userMessageForCode } from './transcript-errors.js';
import { traceLog } from './pipeline-trace.js';
import { classifyOpenAiTranscriptionFailure } from './transcription-provider.js';
import { logProviderQuota } from './provider-health.js';
import { decodeSubtitleTextEntities } from './subtitle-text-entities.js';
import { logSubtitleTextForensicStage } from './video-render/subtitle-text-forensics.js';
import {
  buildTranslationForensicReport,
  isTranslationForensicEnabled,
  logTranslationForensics
} from './translation-forensics.js';
import { postProcessTranslatedSegments } from './subtitle-translation-pipeline.js';
import { buildLanguageConfidence } from './spoken-language-detection.js';
import { evaluateAndRewriteTranslation } from './translation-quality-pipeline.js';
import { runAdaptiveTranslationJob, isAdaptiveTranslationEnabled } from './adaptive-translation-engine.js';
import { detectContentDomain, logDomainDetection } from './domain-detection.js';
import { getDomainLocalizationRules } from './domain-translation-hints.js';
import { buildTranslationTelemetry, logTranslationQuality } from './translation-telemetry.js';
import { investigateTimingOrigins } from './timing-origin-investigation.js';

/** Approximate output expansion vs English subtitle chars for max_tokens budgeting */
const LANG_OUTPUT_EXPANSION = {
  es: 1.38,
  de: 1.38,
  fr: 1.35,
  it: 1.32,
  pt: 1.32,
  nl: 1.28,
  pl: 1.28,
  ru: 1.18,
  ar: 1.05,
  fa: 0.95,
  tr: 1.22,
  zh: 0.72,
  ja: 0.74,
  ko: 0.82,
  en: 1.0
};

const OPENAI_TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_OPENAI_TIMEOUT_MS || 120000);
const GROQ_TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_GROQ_TIMEOUT_MS || 120000);
const GROQ_TRANSLATE_MODEL = String(process.env.TRANSLATE_GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
const MIN_TRANSLATE_KEY_LEN = 10;

function hasGroqTranslateKey() {
  return Boolean(process.env.GROQ_API_KEY && String(process.env.GROQ_API_KEY).length >= MIN_TRANSLATE_KEY_LEN);
}

function hasOpenAiTranslateKey() {
  return Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).length >= MIN_TRANSLATE_KEY_LEN);
}

function isTranslateFailoverEligible(err) {
  if (!err || typeof err !== 'object') return true;
  const name = String(err.name || '');
  if (name === 'QuotaError') return true;
  const code = String(err.code || err.errorCode || '').toUpperCase();
  if (code === 'TRANSLATION_MALFORMED' || code === 'TRANSLATION_UNCHANGED' || code === 'TRANSLATION_EMPTY_RESPONSE') {
    return false;
  }
  const st = Number(err.status || err.statusCode || 0);
  if (st === 401 || st === 403) return false;
  if (st === 429 || st >= 500 || st === 408) return true;
  const msg = String(err.message || '').toLowerCase();
  if (/insufficient_quota|billing|quota exceeded|rate limit|timeout|timed out|econnreset|etimedout/i.test(msg)) {
    return true;
  }
  return st === 0;
}

function translateFail(res, traceId, statusCode, errorCode, message, retryable, phase, providerDebug) {
  console.error(`[translate-failed][${traceId}]`, { errorCode, phase, statusCode, message: String(message).slice(0, 220) });
  traceLog(traceId, 'failed', { phase, errorCode });
  setCORSHeaders(res);
  res.setHeader('X-Trace-Id', traceId);
  const body = {
    success: false,
    errorCode,
    message,
    retryable: Boolean(retryable),
    traceId,
    phase
  };
  if (process.env.ADMIN_DEBUG === 'true' && providerDebug != null && typeof providerDebug === 'object') {
    body.debug = { provider: providerDebug };
  }
  return res.status(statusCode).json(body);
}

export default async function handler(req, res) {
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const traceId = resolveTraceId(req, requestId);
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Trace-Id', traceId);

  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return translateFail(res, traceId, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', false, 'translate-parse');
  }

  console.log(`[translate-start][${traceId}]`, { route: 'translate-srt' });
  traceLog(traceId, 'start', { route: 'translate-srt' });

  const userEmail = requireSessionEmail(req, res);
  if (!userEmail) return;

  try {
    const groqReady = hasGroqTranslateKey();
    const openaiReady = hasOpenAiTranslateKey();
    console.log('[translate-provider]', {
      traceId,
      groq: groqReady,
      openai: openaiReady,
      groqModel: groqReady ? GROQ_TRANSLATE_MODEL : null
    });
    if (!groqReady && !openaiReady) {
      return translateFail(
        res,
        traceId,
        503,
        'TRANSLATION_PROVIDER_UNAVAILABLE',
        'Translation service is not configured.',
        false,
        'translate-parse'
      );
    }

    const { srtContent, targetLanguage, sourceLanguage, metadata } = req.body || {};
    traceLog(traceId, 'parse', { hasSrt: !!srtContent, targetLanguage: targetLanguage || null, sourceLanguage: sourceLanguage || null });

    if (!srtContent || !targetLanguage) {
      return translateFail(res, traceId, 400, 'TRANSCRIPT_MISSING', 'srtContent and targetLanguage are required.', false, 'translate-parse');
    }

    const srcNorm = String(sourceLanguage || '').toLowerCase().trim().slice(0, 8);
    const tgtNorm = String(targetLanguage || '').toLowerCase().trim().slice(0, 8);
    if (srcNorm && tgtNorm && srcNorm === tgtNorm) {
      return translateFail(res, traceId, 400, 'TRANSLATION_SAME_LANGUAGE', 'Source and target language are the same. Pick a different target language.', false, 'translate-parse');
    }

    const segments = parseSRT(srtContent);
    traceLog(traceId, 'parse', { segmentCount: segments.length });

    if (segments.length === 0) {
      return translateFail(res, traceId, 400, 'TRANSLATION_MALFORMED', 'No valid subtitle cues found. Regenerate subtitles and try again.', false, 'translate-parse');
    }

    const transcriptCorpus = segments.map((s) => s.text).join(' ');
    const domainDetection = detectContentDomain({
      transcript: transcriptCorpus,
      title: metadata?.title || metadata?.videoTitle || null,
      description: metadata?.description || metadata?.videoDescription || null,
      segments
    });
    logDomainDetection(traceId, domainDetection);
    const contentDomain = domainDetection.domain || 'general';

    const languageConfidence = buildLanguageConfidence(
      sourceLanguage || 'unknown',
      transcriptCorpus,
      segments
    );
    let resolvedSourceLanguage = languageConfidence.language || sourceLanguage || 'auto';
    if (
      srcNorm &&
      resolvedSourceLanguage !== srcNorm &&
      languageConfidence.detectedBy !== 'whisper_confirmed_by_text'
    ) {
      console.log('[translate-source-language]', {
        traceId,
        clientSource: sourceLanguage,
        resolvedSource: resolvedSourceLanguage,
        confidence: languageConfidence.confidence,
        detectedBy: languageConfidence.detectedBy,
        needsReview: languageConfidence.needsReview
      });
    }

    const srtMinutes = billingMinutesFromSrtSegments(segments);
    const featureCheck = await canUseFeature(userEmail, 'srt', srtMinutes);
    if (featureCheck && featureCheck.allowed === false) {
      return translateFail(res, traceId, 403, 'FEATURE_NOT_AVAILABLE', featureCheck.reason || 'Translation is not available on your current plan.', false, 'translate-parse');
    }

    let translatedSegments;
    let translationForensicMeta = null;
    try {
      const translateResult = await translateSegments(
        segments,
        targetLanguage,
        resolvedSourceLanguage,
        traceId,
        contentDomain
      );
      translatedSegments = translateResult.segments;
      translationForensicMeta = translateResult.forensicMeta;
    } catch (batchErr) {
      const msg = batchErr?.message || String(batchErr);
      const code = batchErr?.errorCode || 'TRANSLATION_UNAVAILABLE';
      const retryable =
        batchErr?.retryable !== false &&
        (/timeout|timed out|ECONNRESET|429|rate/i.test(msg) || batchErr?.code === 'ETIMEDOUT');
      return translateFail(
        res,
        traceId,
        batchErr?.statusCode || (retryable ? 503 : 500),
        code,
        (code === 'TRANSLATION_UNAVAILABLE' || code === 'TRANSLATION_TIMEOUT'
          ? userMessageForCode(code)
          : null) ||
          msg ||
          'Translation failed.',
        retryable,
        batchErr?.phase || 'translate-batch',
        batchErr?.providerDebug || null
      );
    }

    traceLog(traceId, 'translate-response', { batchesDone: true, cues: translatedSegments.length });

    validateTranslationVsOriginal(segments, translatedSegments, resolvedSourceLanguage, targetLanguage);

    const llmOpts = {
      runLlmBatch: completeSubtitleTextBatch,
      runSingleCompletion: (prompts) => completeSingleSubtitleLine(prompts, traceId, 'quality-backtranslate')
    };

    let qualityResult;
    if (isAdaptiveTranslationEnabled()) {
      qualityResult = await runAdaptiveTranslationJob({
        sourceSegments: segments,
        translatedSegments,
        sourceLanguage: resolvedSourceLanguage,
        targetLanguage,
        traceId,
        contentDomain,
        ...llmOpts
      });
    } else {
      qualityResult = await evaluateAndRewriteTranslation({
        sourceSegments: segments,
        translatedSegments,
        sourceLanguage: resolvedSourceLanguage,
        targetLanguage,
        traceId,
        contentDomain,
        ...llmOpts
      });
    }
    translatedSegments = qualityResult.segments;

    investigateTimingOrigins({
      traceId,
      transcriptSegments: segments,
      translatedSegments
    });

    const translatedOneToOne = translatedSegments.map((s) => ({ ...s }));
    const postProcessed = await postProcessTranslatedSegments({
      originalSegments: segments,
      translatedSegments,
      targetLanguage,
      traceId,
      contentDomain,
      runLlmBatch: completeSubtitleTextBatch
    });
    translatedSegments = postProcessed.segments;

    const finalScores = qualityResult.scores;
    logTranslationQuality(
      traceId,
      buildTranslationTelemetry({
        traceId,
        detectedLanguage: resolvedSourceLanguage,
        languageConfidence: languageConfidence.confidence,
        detectedBy: languageConfidence.detectedBy,
        languageNeedsReview: languageConfidence.needsReview,
        translationScore: qualityResult.rewritten ? qualityResult.rewrittenScore : qualityResult.initialScore,
        meaningScore: finalScores?.meaningScore ?? 0,
        fluencyScore: finalScores?.fluencyScore ?? 0,
        rewritten: qualityResult.rewritten,
        initialScore: qualityResult.initialScore,
        rewrittenScore: qualityResult.rewritten ? qualityResult.rewrittenScore : undefined,
        cueCount: translatedSegments.length,
        contentDomain,
        domainConfidence: domainDetection.confidence
      })
    );

    if (isTranslationForensicEnabled() || translationForensicMeta) {
      logTranslationForensics(
        buildTranslationForensicReport(segments, translatedSegments, {
          traceId,
          sourceLanguage: resolvedSourceLanguage,
          targetLanguage,
          translationPrompt: translationForensicMeta?.userPrompt || null,
          systemPrompt: translationForensicMeta?.systemPrompt || null,
          modelUsed: translationForensicMeta?.modelUsed || null,
          temperature: translationForensicMeta?.temperature ?? 0.25,
          provider: translationForensicMeta?.provider || null,
          batchSize: 20,
          postProcessingSteps: [
            isAdaptiveTranslationEnabled()
              ? 'adaptiveTranslation (3-attempt competition, ADAPTIVE_TRANSLATION=1)'
              : 'evaluateAndRewriteTranslation',
            'stripForeignScripts',
            'validatePersianCueScripts',
            'persianFluencyPass (PERSIAN_FLUENCY_PASS=1)',
            'mergeFragmentedSubtitleCues',
            'subtitle-timing-integrity log'
          ],
          timingReport: postProcessed.timingReport,
          pipelineTraceSample: postProcessed.pipelineStages
        })
      );
    }

    logSubtitleTextForensicStage(
      'after_translation',
      translatedSegments.map((seg, i) => ({
        id: `tr-${i}`,
        text: String(seg?.text || '')
      })),
      { traceId, targetLanguage, sourceLanguage: resolvedSourceLanguage }
    );
    logSubtitleTextForensicStage(
      'before_translation',
      segments.map((seg, i) => ({
        id: `src-${i}`,
        text: String(seg?.text || '')
      })),
      { traceId, targetLanguage, sourceLanguage: resolvedSourceLanguage }
    );

    const translatedSRT = generateSRT(translatedSegments);
    traceLog(traceId, 'translate-parse', { outChars: translatedSRT.length });

    const roundTrip = parseSRT(translatedSRT);
    if (roundTrip.length !== translatedSegments.length) {
      return translateFail(
        res,
        traceId,
        500,
        'TRANSLATION_MALFORMED',
        'Translated file cue count mismatch after post-processing.',
        true,
        'translate-parse'
      );
    }
    for (let i = 0; i < translatedSegments.length; i++) {
      const dtStart = Math.abs((roundTrip[i]?.start ?? 0) - translatedSegments[i].start);
      const dtEnd = Math.abs((roundTrip[i]?.end ?? 0) - translatedSegments[i].end);
      if (dtStart > 0.06 || dtEnd > 0.06) {
        return translateFail(res, traceId, 500, 'TRANSLATION_TIMESTAMP_MISMATCH', 'Translated subtitles lost timing alignment.', true, 'translate-parse');
      }
    }

    traceLog(traceId, 'srt', { cues: translatedSegments.length });

    await consumeSrtUsage(userEmail, srtMinutes, {
      route: 'translate-srt',
      processingSessionId: metadata?.processingSessionId || metadata?.sessionId || null,
      segmentCount: translatedSegments.length,
      targetLanguage,
      outputType: 'srt',
      platform: metadata?.platform || null,
      title: metadata?.title || null,
      sourceUrl: metadata?.sourceUrl || null,
      durationSeconds: translatedSegments.length ? Math.ceil(translatedSegments[translatedSegments.length - 1].end || 0) : null,
      filename: metadata?.filename || null,
      ...((metadata && typeof metadata === 'object') ? metadata : {})
    });

    traceLog(traceId, 'success', { segmentCount: translatedSegments.length, targetLanguage });

    console.log(`[translate-render][${traceId}]`, { segmentCount: translatedSegments.length, targetLanguage });

    setCORSHeaders(res);
    return res.status(200).json({
      success: true,
      traceId,
      srtContent: translatedSRT,
      segmentCount: translatedSegments.length,
      targetLanguage
    });
  } catch (error) {
    console.error('TRANSLATE_SRT_ERROR', traceId, error);
    if (error?.errorCode === 'OPENAI_QUOTA_EXCEEDED' || error?.errorCode === 'TRANSLATION_UNAVAILABLE') {
      const dbg =
        process.env.ADMIN_DEBUG === 'true' && error?.providerDebug && typeof error.providerDebug === 'object'
          ? error.providerDebug
          : null;
      const code = error.errorCode === 'OPENAI_QUOTA_EXCEEDED' ? 'TRANSLATION_UNAVAILABLE' : error.errorCode;
      return translateFail(
        res,
        traceId,
        error?.statusCode || 503,
        code,
        error?.message || userMessageForCode('TRANSLATION_UNAVAILABLE'),
        false,
        error?.phase || 'translate-batch',
        dbg
      );
    }
    const msg = String(error?.message || error);
    const code = error?.errorCode || 'TRANSLATION_UNAVAILABLE';
    const retryable =
      error?.retryable !== false &&
      ![
        'TRANSLATION_SAME_LANGUAGE',
        'TRANSLATION_MALFORMED',
        'TRANSCRIPT_MISSING',
        'OPENAI_QUOTA_EXCEEDED'
      ].includes(code);
    return translateFail(res, traceId, error?.statusCode || 500, code, msg, retryable, error?.phase || 'translate-parse');
  }
}

const SRT_TIME_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*--(?:>|&gt;|@gt;)\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/i;

function preprocessSrtInput(srtContent) {
  return String(srtContent || '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/--&gt;/gi, '-->')
    .replace(/--@gt;/gi, '-->')
    .replace(/\n# Generated by Cutup[^\n]*/gi, '')
    .replace(/\[Preview only[\s\S]*?(?=\n\n\d+\n|$)/gi, '')
    .replace(/\[Preview ends here[\s\S]*?(?=\n\n\d+\n|$)/gi, '')
    .trim();
}

function parseSRT(srtContent) {
  const segments = [];
  const normalized = preprocessSrtInput(srtContent);
  if (!normalized) return segments;

  const blocks = normalized.split(/\n\s*\n/);
  
  for (const block of blocks) {
    const lines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let timeLineIdx = -1;
    let timeMatch = null;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(SRT_TIME_RE);
      if (m) {
        timeLineIdx = i;
        timeMatch = m;
        break;
      }
    }
    if (!timeMatch) continue;
    
    const startTime = parseSRTTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endTime = parseSRTTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    const text = decodeSubtitleTextEntities(
      lines
        .slice(timeLineIdx + 1)
        .filter((line) => !/^\[preview/i.test(line) && !/^#\s*generated by cutup/i.test(line))
        .join(' ')
    );

    if (text.length > 0) {
      segments.push({ start: startTime, end: endTime, text });
    }
  }
  
  return segments;
}

function parseSRTTime(hours, minutes, seconds, milliseconds) {
  return parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10) + parseInt(milliseconds, 10) / 1000;
}

function normalizeForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateTranslationVsOriginal(originalSegments, translatedSegments, sourceLanguage, targetLanguage) {
  if (!translatedSegments || translatedSegments.length !== originalSegments.length) {
    const err = new Error('Translation returned the wrong number of subtitle cues.');
    err.errorCode = 'TRANSLATION_MALFORMED';
    err.phase = 'translate-parse';
    err.retryable = true;
    throw err;
  }

  let empty = 0;
  let unchangedLong = 0;
  let longCount = 0;

  for (let i = 0; i < originalSegments.length; i++) {
    const t = translatedSegments[i]?.text;
    if (!t || !String(t).trim()) {
      empty++;
      continue;
    }
    const o = originalSegments[i].text;
    const nt = normalizeForCompare(t);
    const no = normalizeForCompare(o);
    if (no.length >= 18) {
      longCount++;
      if (nt === no) unchangedLong++;
    }
  }

  if (empty > 0) {
    const err = new Error('Translation produced empty subtitle lines.');
    err.errorCode = 'TRANSLATION_EMPTY_RESPONSE';
    err.phase = 'translate-parse';
    err.retryable = true;
    throw err;
  }

  const src = String(sourceLanguage || '').toLowerCase().slice(0, 2);
  const tgt = String(targetLanguage || '').toLowerCase().slice(0, 2);
  const threshold = src && tgt && src !== tgt ? 0.34 : 0.52;
  if (longCount >= 4 && unchangedLong / longCount > threshold) {
    const err = new Error(
      'Translation did not change the subtitle text enough — the output still matches the original. Try again or pick another target language.'
    );
    err.errorCode = 'TRANSLATION_UNCHANGED';
    err.phase = 'translate-parse';
    err.retryable = true;
    throw err;
  }
}

function computeMaxTokensForBatch(batch, targetLanguage) {
  const charEstimate = batch.reduce((n, s) => n + String(s.text || '').length, 0);
  const expansion = LANG_OUTPUT_EXPANSION[String(targetLanguage || '').toLowerCase().slice(0, 2)] ?? 1.28;
  return Math.min(4096, Math.max(768, Math.ceil(charEstimate * 2.1 * expansion) + batch.length * 48));
}

const LANGUAGE_NAMES = {
    fa: 'Persian/Farsi',
    en: 'English',
    ar: 'Arabic',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    ru: 'Russian',
    tr: 'Turkish',
    zh: 'Chinese',
    ja: 'Japanese',
    ko: 'Korean'
};

const GROQ_TRANSLATE_RULES =
  ' CRITICAL OUTPUT RULES: DO NOT add explanations. DO NOT add numbering. DO NOT add timestamps. DO NOT use HTML entities (&gt;, &lt;, &amp;) or @gt;. RETURN ONLY plain subtitle text lines in the same order. KEEP EXACT ORDER. Use exactly N segments separated only by ---SEGMENT--- on its own line between segments.';

function buildTranslationPrompts(
  batch,
  targetLanguage,
  sourceLanguage,
  { groqHardening = false, domain = 'general' } = {}
) {
  const targetLangName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const sourceLangName = sourceLanguage
    ? LANGUAGE_NAMES[sourceLanguage] || sourceLanguage
    : 'the original language';
  const batchTexts = batch.map((s) => s.text).join('\n---SEGMENT---\n');
  const n = batch.length;
  const groqExtra = groqHardening ? GROQ_TRANSLATE_RULES.replace(/exactly N/g, `exactly ${n}`) : '';
  const tgt = String(targetLanguage || '').toLowerCase().slice(0, 2);
  const nativeSubtitleRules =
    tgt === 'fa'
      ? ' For Persian (Farsi): translate MEANING into native conversational Iranian subtitle Persian — how people actually talk on fitness/business YouTube, not literal word-for-word English. Examples: "Nice deadlift" → "ددلیفتت عالیه" (NOT "ددلیفت خوبی است"). Keep fitness terms natural (ددلیفت، اسکوات). Entrepreneurship/business terms should sound like startup Persian, not formal bureaucracy. Preserve humor and speaker tone. Use ONLY Persian in Arabic script. NEVER output Devanagari, Hindi, Chinese, Japanese, Korean, Vietnamese, English, Cyrillic, or other foreign scripts. No Latin letters. Prefer complete readable thoughts; avoid tiny fragments.'
      : tgt === 'ar'
        ? ' For Arabic: use natural modern subtitle Arabic suitable for on-screen captions; avoid overly literal translation.'
        : '';
  const domainRules = getDomainLocalizationRules(domain, targetLanguage);
  const systemPrompt = `You are a professional subtitle translator. Translate each segment from the source language to ${targetLangName}. Output MUST contain exactly ${n} segments separated only by the delimiter "---SEGMENT---" on its own between segments. No numbering, no timestamps, no explanations.${nativeSubtitleRules}${domainRules}${groqExtra}`;
  const userPrompt = `Translate these ${n} subtitle segments from ${sourceLangName} to ${targetLangName}. Every segment must be fully translated. Return ONLY translated subtitle text — no preamble, no markdown, no bullets. Do not use HTML entities (no &gt;, &lt;, &amp;) or @gt; — plain text only.

Segments (delimiter ---SEGMENT---):
${batchTexts}

Translated segments (${n} parts, delimiter ---SEGMENT--- only):`;
  return { systemPrompt, userPrompt };
}

/** Remove provider chatter, markdown fences, and list prefixes from raw model output. */
function sanitizeTranslatedRaw(raw) {
  let t = String(raw || '')
    .replace(/\uFEFF/g, '')
    .trim();
  if (!t) return '';
  t = t.replace(/^```[a-zA-Z]*\s*\r?\n?/gm, '').replace(/\r?\n?```\s*$/gm, '').trim();
  t = t
    .replace(
      /^(?:here\s+(?:is|are)\s+(?:the\s+)?(?:translation|translated\s+(?:subtitles?|segments?|text))|translated?\s*(?:subtitles?|segments?|text)\s*:)\s*[\r\n:]*/gim,
      ''
    )
    .trim();
  t = t
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s]*[-*•]\s+/, '').trim())
    .join('\n')
    .trim();
  return t;
}

function sanitizeSegmentText(text) {
  let t = sanitizeTranslatedRaw(text);
  if (!t) return '';
  t = t.replace(/^\d+\.\s+/, '').trim();
  t = t.replace(/^#+\s+/, '').trim();
  return decodeSubtitleTextEntities(t);
}

function isNumericOnlyLine(line) {
  return /^\d{1,4}$/.test(String(line || '').trim());
}

function isTimestampLine(line) {
  return SRT_TIME_RE.test(String(line || '').trim());
}

/** Strict delimiter / newline split (no recovery). */
function parseTranslatedBlocksStrict(raw) {
  const sanitized = sanitizeTranslatedRaw(raw);
  if (!sanitized) return [];
  let blocks = sanitized.split('---SEGMENT---').map((part) => sanitizeSegmentText(part));
  const nonEmpty = blocks.filter(Boolean);
  if (nonEmpty.length <= 1 && blocks.length <= 1) {
    blocks = sanitized
      .split(/\r?\n/)
      .map((line) => sanitizeSegmentText(line))
      .filter(Boolean);
  } else {
    blocks = blocks.filter(Boolean);
  }
  return blocks;
}

/** Lenient split: drop blanks, indices, timestamps; keep text blocks in order. */
function parseTranslatedBlocksLenient(raw) {
  const sanitized = sanitizeTranslatedRaw(raw);
  if (!sanitized) return [];

  let parts = sanitized.split('---SEGMENT---').map((p) => sanitizeSegmentText(p));
  if (parts.filter(Boolean).length <= 1) {
    parts = sanitized.split(/\r?\n/).map((line) => sanitizeSegmentText(line));
  }

  return parts
    .map((line) => String(line || '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isNumericOnlyLine(line))
    .filter((line) => !isTimestampLine(line))
    .filter((line) => !/^---\s*segment\s*---$/i.test(line));
}

/**
 * Map translated text blocks onto original cue timestamps (recovery).
 */
function recoverBatchSegments(originalBatch, translatedBlocks, traceId, batchIndex) {
  const expected = originalBatch.length;
  let blocks = translatedBlocks.map((b) => sanitizeSegmentText(b)).filter((b) => b.length > 0);

  if (blocks.length > expected) {
    const merged = [];
    for (let i = 0; i < expected; i++) {
      const start = Math.floor((i * blocks.length) / expected);
      const end = Math.floor(((i + 1) * blocks.length) / expected);
      const slice = blocks.slice(start, Math.max(start + 1, end));
      merged.push(slice.join(' ').trim());
    }
    blocks = merged;
  }

  let fallbackCount = 0;
  let recoveredCount = 0;
  const segments = originalBatch.map((seg, i) => {
    let text = blocks[i];
    let fromFallback = false;
    if (text == null || !String(text).trim()) {
      text = String(seg.text || '').trim();
      fromFallback = true;
      fallbackCount++;
    } else {
      recoveredCount++;
    }
    return {
      start: seg.start,
      end: seg.end,
      text: String(text).trim(),
      fromFallback
    };
  });

  const recoveredRatio = expected > 0 ? recoveredCount / expected : 0;
  const hasUsableText = segments.some((s) => s.text.length > 0);

  return {
    segments: segments.map(({ start, end, text }) => ({ start, end, text })),
    recoveredCount,
    recoveredRatio,
    fallbackCount,
    hasUsableText,
    expected,
    gotBlocks: translatedBlocks.length
  };
}

const MIN_RECOVERY_RATIO = 0.4;

function mapStrictBatch(originalBatch, translatedBlocks) {
  return originalBatch.map((seg, j) => ({
    start: seg.start,
    end: seg.end,
    text: translatedBlocks[j]
  }));
}

function mapTranslateProviderError(apiErr, provider, traceId, batchIndex) {
  const st =
    Number(apiErr?.status) ||
    Number(apiErr?.response?.status) ||
    (String(apiErr?.code || '').toLowerCase() === 'insufficient_quota' ? 429 : 0) ||
    500;
  const errObj =
    apiErr?.error && typeof apiErr.error === 'object'
      ? apiErr.error
      : { message: String(apiErr?.message || apiErr || ''), code: apiErr?.code };
  const classified = classifyOpenAiTranscriptionFailure(st, { error: errObj });
  const e = new Error(classified.rawMessage || String(errObj.message || 'Translation provider error'));
  e.statusCode = classified.httpStatus || st || 503;
  e.phase = provider === 'groq' ? 'translate-groq' : 'translate-openai';
  e.batchIndex = batchIndex;
  e.providerDebug = { provider, openaiCode: classified.openaiCode, httpStatus: e.statusCode };
  if (classified.category === 'quota') {
    logProviderQuota(provider, { traceId, phase: 'translate_gpt', batchIndex });
    e.errorCode = 'TRANSLATION_UNAVAILABLE';
    e.retryable = false;
    e.message = 'Translation provider quota is temporarily unavailable.';
  } else if (classified.category === 'rate_limit' || st === 429) {
    e.errorCode = 'TRANSLATION_TIMEOUT';
    e.retryable = true;
    e.message = 'Translation rate limit hit. Please try again.';
  } else {
    e.errorCode = 'TRANSLATION_UNAVAILABLE';
    e.retryable = st >= 500 || st === 408 || /timeout|econnreset/i.test(String(e.message));
  }
  return e;
}

/**
 * Groq chat completion (OpenAI-compatible API).
 */
export async function translateWithGroq({
  systemPrompt,
  userPrompt,
  maxTokens,
  traceId,
  batchIndex,
  temperature = 0.25
}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || String(apiKey).length < MIN_TRANSLATE_KEY_LEN) {
    const e = new Error('GROQ_API_KEY not configured');
    e.errorCode = 'TRANSLATION_PROVIDER_UNAVAILABLE';
    e.retryable = false;
    throw e;
  }
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
    timeout: GROQ_TRANSLATE_TIMEOUT_MS
  });
  console.log(`[translate-groq][${traceId}]`, { batchIndex, model: GROQ_TRANSLATE_MODEL, maxTokens });
  try {
    return await client.chat.completions.create({
      model: GROQ_TRANSLATE_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens
    });
  } catch (apiErr) {
    console.error(`[translate-groq][${traceId}] batch ${batchIndex}`, apiErr?.message || apiErr);
    throw mapTranslateProviderError(apiErr, 'groq', traceId, batchIndex);
  }
}

/**
 * OpenAI chat completion (fallback).
 */
export async function translateWithOpenAi({
  systemPrompt,
  userPrompt,
  maxTokens,
  traceId,
  batchIndex,
  isFallback = false,
  temperature = 0.25
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || String(apiKey).length < MIN_TRANSLATE_KEY_LEN) {
    const e = new Error('OPENAI_API_KEY not configured');
    e.errorCode = 'TRANSLATION_PROVIDER_UNAVAILABLE';
    e.retryable = false;
    throw e;
  }
  const client = new OpenAI({ apiKey, timeout: OPENAI_TRANSLATE_TIMEOUT_MS });
  const logTag = isFallback ? 'translate-openai-fallback' : 'translate-openai';
  console.log(`[${logTag}][${traceId}]`, { batchIndex, model: 'gpt-4o-mini', maxTokens, isFallback });
  try {
    return await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      temperature,
      max_tokens: maxTokens
    });
  } catch (apiErr) {
    console.error(`[${logTag}][${traceId}] batch ${batchIndex}`, apiErr?.message || apiErr);
    throw mapTranslateProviderError(apiErr, 'openai', traceId, batchIndex);
  }
}

/**
 * LLM batch for fluency / rewrite passes (same segment count + timestamps as input batch).
 */
/** Single-line LLM completion (back-translation / scoring helpers). */
export async function completeSingleSubtitleLine(prompts, traceId, label) {
  const batch = [{ start: 0, end: 1, text: '.' }];
  const out = await completeSubtitleTextBatch(batch, prompts, traceId, label, { temperature: 0.15 });
  return String(out[0]?.text || '').trim();
}

export async function completeSubtitleTextBatch(batch, prompts, traceId, batchLabel, options = {}) {
  const maxTokens = computeMaxTokensForBatch(batch, 'fa');
  const temperature = Number(options.temperature ?? 0.25);
  const groqReady = hasGroqTranslateKey();
  const openaiReady = hasOpenAiTranslateKey();

  if (groqReady) {
    try {
      const completion = await translateWithGroq({
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        maxTokens,
        traceId,
        batchIndex: batchLabel,
        temperature
      });
      return applyBatchTranslation(completion, batch, traceId, batchLabel);
    } catch (groqErr) {
      if (!isTranslateFailoverEligible(groqErr) || !openaiReady) throw groqErr;
    }
  }
  if (openaiReady) {
    const completion = await translateWithOpenAi({
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      maxTokens,
      traceId,
      batchIndex: batchLabel,
      isFallback: groqReady,
      temperature
    });
    return applyBatchTranslation(completion, batch, traceId, batchLabel);
  }
  const e = new Error('No translation provider available');
  e.errorCode = 'TRANSLATION_PROVIDER_UNAVAILABLE';
  throw e;
}

function applyBatchTranslation(completion, batch, traceId, batchIndex) {
  const rawContent = completion?.choices?.[0]?.message?.content;
  traceLog(traceId, 'translate-response', {
    batchIndex,
    finishReason: completion?.choices?.[0]?.finish_reason || null,
    contentChars: rawContent ? String(rawContent).length : 0
  });
  console.log(`[translate-response][${traceId}]`, {
    batchIndex,
    finishReason: completion?.choices?.[0]?.finish_reason || null,
    contentChars: rawContent ? String(rawContent).length : 0
  });
  if (!rawContent || !String(rawContent).trim()) {
    const e = new Error('Empty translation response from provider.');
    e.errorCode = 'TRANSLATION_EMPTY_RESPONSE';
    e.retryable = true;
    throw e;
  }

  const sanitizedRaw = sanitizeTranslatedRaw(rawContent);
  const strictBlocks = parseTranslatedBlocksStrict(sanitizedRaw);

  if (strictBlocks.length === batch.length) {
    return mapStrictBatch(batch, strictBlocks);
  }

  console.log('[translate-recovery]', {
    traceId,
    batchIndex,
    expected: batch.length,
    strictGot: strictBlocks.length,
    mode: 'segment-count-mismatch'
  });

  const lenientBlocks = parseTranslatedBlocksLenient(sanitizedRaw);
  const recovery = recoverBatchSegments(batch, lenientBlocks, traceId, batchIndex);

  if (recovery.hasUsableText && recovery.recoveredRatio >= MIN_RECOVERY_RATIO) {
    console.log('[translate-recovery-success]', {
      traceId,
      batchIndex,
      expected: recovery.expected,
      strictGot: strictBlocks.length,
      lenientGot: lenientBlocks.length,
      recoveredCount: recovery.recoveredCount,
      recoveredRatio: Number(recovery.recoveredRatio.toFixed(3)),
      fallbackCount: recovery.fallbackCount
    });
    return recovery.segments;
  }

  console.error('[translate-recovery-failed]', {
    traceId,
    batchIndex,
    expected: recovery.expected,
    strictGot: strictBlocks.length,
    lenientGot: lenientBlocks.length,
    recoveredCount: recovery.recoveredCount,
    recoveredRatio: Number(recovery.recoveredRatio.toFixed(3)),
    hasUsableText: recovery.hasUsableText
  });

  const e = new Error(
    recovery.hasUsableText
      ? `Translation recovery insufficient (${Math.round(recovery.recoveredRatio * 100)}% of segments recovered, need ${Math.round(MIN_RECOVERY_RATIO * 100)}%).`
      : 'No usable translated text in provider response.'
  );
  e.errorCode = 'TRANSLATION_MALFORMED';
  e.retryable = true;
  throw e;
}

async function translateBatchWithProviders(
  batch,
  targetLanguage,
  sourceLanguage,
  traceId,
  batchIndex,
  contentDomain = 'general'
) {
  const groqPrompts = buildTranslationPrompts(batch, targetLanguage, sourceLanguage, {
    groqHardening: true,
    domain: contentDomain
  });
  const openaiPrompts = buildTranslationPrompts(batch, targetLanguage, sourceLanguage, {
    groqHardening: false,
    domain: contentDomain
  });
  const maxTokens = computeMaxTokensForBatch(batch, targetLanguage);
  const groqReady = hasGroqTranslateKey();
  const openaiReady = hasOpenAiTranslateKey();
  let lastErr = null;

  if (groqReady) {
    try {
      const completion = await translateWithGroq({
        systemPrompt: groqPrompts.systemPrompt,
        userPrompt: groqPrompts.userPrompt,
        maxTokens,
        traceId,
        batchIndex
      });
      return { segments: applyBatchTranslation(completion, batch, traceId, batchIndex), provider: 'groq' };
    } catch (groqErr) {
      lastErr = groqErr;
      if (!isTranslateFailoverEligible(groqErr) || !openaiReady) {
        throw groqErr;
      }
      console.log('[translate-openai-fallback]', {
        traceId,
        batchIndex,
        from: 'groq',
        to: 'openai',
        reason: groqErr?.errorCode || groqErr?.message
      });
    }
  }

  if (openaiReady) {
    const completion = await translateWithOpenAi({
      systemPrompt: openaiPrompts.systemPrompt,
      userPrompt: openaiPrompts.userPrompt,
      maxTokens,
      traceId,
      batchIndex,
      isFallback: Boolean(groqReady && lastErr)
    });
    return { segments: applyBatchTranslation(completion, batch, traceId, batchIndex), provider: 'openai' };
  }

  if (lastErr) throw lastErr;
  const e = new Error('No translation provider available');
  e.errorCode = 'TRANSLATION_PROVIDER_UNAVAILABLE';
  e.retryable = false;
  throw e;
}

async function translateSegments(segments, targetLanguage, sourceLanguage, traceId, contentDomain = 'general') {
  const batchSize = 20;
  const translatedSegments = [];
  let lastProvider = null;
  let forensicMeta = null;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;

    traceLog(traceId, 'translate-batch', { batchIndex, cues: batch.length });
    console.log(`[translate-batch][${traceId}]`, { batchIndex, cues: batch.length });

    const groqPrompts = buildTranslationPrompts(batch, targetLanguage, sourceLanguage, {
      groqHardening: true,
      domain: contentDomain
    });
    const openaiPrompts = buildTranslationPrompts(batch, targetLanguage, sourceLanguage, {
      groqHardening: false,
      domain: contentDomain
    });

    const { segments: mapped, provider } = await translateBatchWithProviders(
      batch,
      targetLanguage,
      sourceLanguage,
      traceId,
      batchIndex,
      contentDomain
    );
    lastProvider = provider;
    translatedSegments.push(...mapped);

    if (!forensicMeta && (isTranslationForensicEnabled() || batchIndex === 1)) {
      const useGroq = provider === 'groq';
      forensicMeta = {
        systemPrompt: (useGroq ? groqPrompts : openaiPrompts).systemPrompt,
        userPrompt: (useGroq ? groqPrompts : openaiPrompts).userPrompt,
        modelUsed: useGroq ? GROQ_TRANSLATE_MODEL : 'gpt-4o-mini',
        temperature: 0.25,
        provider
      };
    }

    traceLog(traceId, 'translate-parse', { batchIndex, mappedCues: batch.length, provider });
    console.log(`[translate-parse][${traceId}]`, { batchIndex, mappedCues: batch.length, provider });
  }

  console.log('[translate-success]', {
    traceId,
    segmentCount: translatedSegments.length,
    provider: lastProvider,
    batches: Math.ceil(segments.length / batchSize)
  });

  return { segments: translatedSegments, forensicMeta };
}

function generateSRT(segments) {
  let srtContent = '';
  
  segments.forEach((segment, index) => {
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);
    srtContent += `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n\n`;
  });
  
  return srtContent;
}

function formatSRTTime(seconds) {
  const secs = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const secsPart = Math.floor(secs % 60);
  const milliseconds = Math.floor((secs % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secsPart).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}
