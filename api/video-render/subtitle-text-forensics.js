/**
 * Forensic logging for Persian/RTL subtitle text — compare string at each pipeline stage.
 * Enable: RENDER_SUBTITLE_FORENSIC=1
 * Optional: RENDER_SUBTITLE_FORENSIC_MAX=10 (default 8 cues per stage)
 */
import { isRtlText } from './rtl-text.js';

const BIDI_MARK_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

export function isSubtitleTextForensicEnabled(sampleText = '') {
  const flag = String(process.env.RENDER_SUBTITLE_FORENSIC || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  return isRtlText(sampleText);
}

export function forensicMaxCues() {
  const n = Number(process.env.RENDER_SUBTITLE_FORENSIC_MAX || 8);
  return Number.isFinite(n) && n > 0 ? Math.min(50, Math.round(n)) : 8;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function textToCodepoints(text) {
  return [...String(text || '')].map((c) => {
    const cp = c.codePointAt(0);
    return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  });
}

/**
 * @param {string} stage
 * @param {string|number} cueId
 * @param {string} text
 * @param {object} [extra]
 */
export function buildForensicEntry(stage, cueId, text, extra = {}) {
  const t = String(text ?? '');
  const entry = {
    stage,
    cueId,
    text: t,
    codepoints: textToCodepoints(t)
  };
  const markers = [...t].filter((c) => BIDI_MARK_RE.test(c)).map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`);
  if (markers.length) entry.bidiMarkers = markers;
  if (extra.style) entry.style = extra.style;
  return entry;
}

/**
 * @param {string} stage
 * @param {Array<{ id?: string, index?: number, text?: string }>} cues
 * @param {object} [ctx]
 */
export function logSubtitleTextForensicStage(stage, cues, ctx = {}) {
  const list = Array.isArray(cues) ? cues : [];
  const sample = list.map((c) => c?.text).find(Boolean) || '';
  if (!isSubtitleTextForensicEnabled(sample)) return null;

  const max = forensicMaxCues();
  const entries = list.slice(0, max).map((cue, i) =>
    buildForensicEntry(stage, cue?.id ?? cue?.index ?? `cue-${i}`, cue?.text ?? '')
  );

  const payload = {
    tag: 'subtitle-text-forensic',
    stage,
    traceId: ctx.traceId ?? null,
    jobId: ctx.jobId ?? null,
    ...(ctx.note ? { note: ctx.note } : {}),
    ...(ctx.targetLanguage ? { targetLanguage: ctx.targetLanguage } : {}),
    ...(ctx.sourceLanguage ? { sourceLanguage: ctx.sourceLanguage } : {}),
    ...(ctx.selectedVersion ? { selectedVersion: ctx.selectedVersion } : {}),
    ...(ctx.captionMode ? { captionMode: ctx.captionMode } : {}),
    cueCount: list.length,
    logged: entries.length,
    entries
  };

  console.log(JSON.stringify(payload));
  return payload;
}

/**
 * @param {string} assContent
 * @param {number} [limit]
 */
export function extractAssDialogueForensics(assContent, limit = 5) {
  const lines = String(assContent || '')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('Dialogue:'));
  return lines.slice(0, limit).map((line, i) => {
    const parts = line.split(',');
    const text = parts.length >= 10 ? parts.slice(9).join(',') : '';
    const style = parts[3] || '';
    return buildForensicEntry('production_ass_dialogue', `dialogue-${i}`, text, { style });
  });
}

/**
 * Log first N Dialogue lines from production ASS file content.
 */
export function logProductionAssDialogueDump(assContent, ctx = {}) {
  const sample = String(assContent || '').slice(0, 4000);
  if (!isSubtitleTextForensicEnabled(sample)) return null;

  const entries = extractAssDialogueForensics(assContent, 5);
  const payload = {
    tag: 'subtitle-text-forensic',
    stage: 'production_ass_first_dialogues',
    traceId: ctx.traceId ?? null,
    jobId: ctx.jobId ?? null,
    dialogueCount: (String(assContent || '').match(/^Dialogue:/gm) || []).length,
    entries
  };
  console.log(JSON.stringify(payload));
  return payload;
}
