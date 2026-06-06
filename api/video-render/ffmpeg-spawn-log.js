/**
 * Uniform logging for every FFmpeg invocation (spawn or exec).
 */
import { formatFfmpegCommand, trackFfmpegStart, trackFfmpegEnd } from './ffmpeg-job-tracker.js';

export { formatFfmpegCommand, trackFfmpegStart, trackFfmpegEnd };

export function logFfmpegStart(purpose, binary, args = [], cwd = null, jobId = null) {
  return trackFfmpegStart(jobId, purpose, binary, args, cwd);
}

export function logFfmpegEnd(jobId, trackId, purpose) {
  trackFfmpegEnd(jobId, trackId, purpose);
}
