/**
 * ASR V1 post-processing chain — isolated for feature-flag rollback and v1/v2 comparison.
 * NOT used when ASR_PIPELINE=v2.
 */
import { applyWhisperLeadingOffsetIfNeeded } from '../whisper-leading-offset.js';
import { mergeRollingCaptionChains } from '../video-render/subtitle-pipeline.js';
import { refineTranscriptTimings } from '../refine-transcript-timings.js';
import { logSubtitleTextForensicStage } from '../video-render/subtitle-text-forensics.js';
import { sanitizeTranscriptSegments } from '../video-render/non-speech-tags.js';

/**
 * Persian-only GPT correction (legacy V1).
 * @param {string} text
 * @param {string} apiKey
 */
export async function correctTranscriptionWithGPT(text, apiKey) {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });

  const systemPrompt = `شما یک متخصص تصحیح متن فارسی هستید که در تصحیح شعر، آهنگ و متن فارسی تخصص دارید. 
متن تبدیل شده از صوت را با دقت بالا تصحیح کنید. به خصوص:
- کلمات شعر و آهنگ فارسی
- نام‌های فارسی
- عبارات رایج فارسی
- حفظ ساختار و معنی متن

فقط اشتباهات را تصحیح کنید و ساختار کلی متن را حفظ کنید.`;

  const userPrompt = `متن زیر که از تبدیل صوت به متن (احتمالاً شعر یا آهنگ فارسی) به دست آمده را با دقت بالا تصحیح کنید.

متن اصلی:
${text}

لطفاً:
1. تمام کلمات اشتباه را درست کنید
2. ساختار شعر/آهنگ را حفظ کنید
3. معنی و مفهوم را حفظ کنید
4. فقط متن تصحیح شده را برگردانید، بدون توضیح اضافی

متن تصحیح شده:`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0,
      max_tokens: Math.min(text.length * 3, 8000)
    });
    const correctedText = completion.choices[0].message.content.trim();
    return { text: correctedText.replace(/```[\s\S]*?```/g, '').trim() };
  } catch (error) {
    const fallbackCompletion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0,
      max_tokens: Math.min(text.length * 2, 4000)
    });
    const correctedText = fallbackCompletion.choices[0].message.content.trim();
    return { text: correctedText.replace(/```[\s\S]*?```/g, '').trim() };
  }
}

function mapGptCorrectedSegments(originalText, correctedText, segments) {
  if (!segments?.length) return segments || [];

  const totalDuration = segments[segments.length - 1].end || 0;
  const correctedWords = correctedText.split(/\s+/).filter((w) => w.trim().length > 0);
  const originalWords = originalText.split(/\s+/).filter((w) => w.trim().length > 0);

  if (Math.abs(correctedWords.length - originalWords.length) / Math.max(originalWords.length, 1) < 0.5) {
    let wordIndex = 0;
    return segments.map((segment) => {
      const segmentWords = segment.text.trim().split(/\s+/).filter((w) => w.trim().length > 0);
      const wordsForSegment = correctedWords.slice(wordIndex, wordIndex + segmentWords.length);
      wordIndex += segmentWords.length;
      return {
        ...segment,
        text: wordsForSegment.length > 0 ? wordsForSegment.join(' ').trim() : segment.text.trim()
      };
    });
  }

  let charIndex = 0;
  return segments.map((segment) => {
    const segmentDuration = segment.end - segment.start;
    const segmentRatio = totalDuration > 0 ? segmentDuration / totalDuration : 1 / segments.length;
    const charsForSegment = Math.ceil(correctedText.length * segmentRatio);
    const segmentText = correctedText.substring(charIndex, charIndex + charsForSegment).trim();
    charIndex += charsForSegment;
    return { ...segment, text: segmentText || segment.text };
  });
}

/**
 * Run full V1 mutation chain on raw provider transcript.
 * @param {object} opts
 * @param {object} opts.transcript
 * @param {string} [opts.openAiKeyForGpt]
 * @param {string} [opts.traceId]
 */
export async function applyV1PostProcessing(opts = {}) {
  const { transcript, openAiKeyForGpt = '', traceId = '' } = opts;
  const rawSegments = transcript?.segments || [];

  logSubtitleTextForensicStage(
    'whisper_raw',
    rawSegments.map((seg, i) => ({ id: `whisper-${i}`, text: String(seg?.text || '') })),
    { traceId }
  );

  const whisperLang = String(transcript.language || '').toLowerCase();
  const isWhisperPersian =
    whisperLang === 'fa' || whisperLang === 'per' || whisperLang === 'persian' || whisperLang === 'fas';
  const totalLen = (transcript.text || '').length;
  const scriptChars = (transcript.text || '').match(/[\u0600-\u06FF]/g)?.length || 0;
  const scriptRatio = totalLen > 0 ? scriptChars / totalLen : 0;
  const shouldRunPersianGptCorrection = isWhisperPersian && scriptRatio >= 0.25;

  let correctedText = transcript.text || '';
  let correctedSegments = [...rawSegments];

  if (shouldRunPersianGptCorrection && openAiKeyForGpt.length >= 10) {
    try {
      const corrected = await correctTranscriptionWithGPT(transcript.text, openAiKeyForGpt);
      correctedText = corrected.text;
      if (correctedSegments.length) {
        correctedSegments = mapGptCorrectedSegments(transcript.text, correctedText, correctedSegments);
      }
    } catch (err) {
      console.warn('[asr-v1] GPT correction failed:', err?.message || err);
    }
  }

  const validSegments = (correctedSegments || []).filter(
    (s) =>
      s &&
      typeof s.start === 'number' &&
      typeof s.end === 'number' &&
      s.start >= 0 &&
      s.end > s.start &&
      s.text &&
      s.text.trim().length > 0
  );

  const wordSyncedSegments = refineTranscriptTimings(validSegments);
  const { segments: offsetSegments, offsetSec: whisperLeadingOffsetSec } =
    applyWhisperLeadingOffsetIfNeeded(wordSyncedSegments);
  const timelineSegments = sanitizeTranscriptSegments(mergeRollingCaptionChains(offsetSegments));

  logSubtitleTextForensicStage(
    'whisper_final',
    timelineSegments.map((seg, i) => ({
      id: `whisper-final-${i}`,
      text: String(seg?.text || '')
    })),
    { traceId, note: 'after_v1_postprocess' }
  );

  const text = timelineSegments.map((s) => String(s.text || '').trim()).filter(Boolean).join(' ');

  return {
    text,
    segments: timelineSegments,
    rawSegments,
    validSegments,
    wordSyncedSegments,
    offsetSegments,
    correctedSegments,
    whisperLeadingOffsetSec: whisperLeadingOffsetSec || 0,
    asrPipeline: 'v1'
  };
}
