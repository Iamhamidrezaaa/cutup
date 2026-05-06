/**
 * Production pipeline trace logging. Every line: [trace-<phase>][<traceId>] payload
 * Phases: start, parse, normalize, yt-dlp, audio-download, ffmpeg, transcription,
 *         openai, srt, success, failed
 */

export function traceLog(traceId, phase, data = {}) {
  const tid = traceId || 'no-trace';
  const tag = `[trace-${phase}][${tid}]`;
  if (data == null || (typeof data === 'object' && Object.keys(data).length === 0)) {
    console.log(tag);
    return;
  }
  console.log(tag, typeof data === 'object' ? data : { detail: data });
}
