/**
 * Uniform logging for every FFmpeg invocation (spawn or exec).
 */

export function formatFfmpegCommand(binary, args = [], cwd = null) {
  const parts = [binary, ...args].map((part) => {
    const s = String(part);
    return /[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  });
  const cmd = parts.join(' ');
  return cwd ? `(cwd=${cwd}) ${cmd}` : cmd;
}

export function logFfmpegStart(purpose, binary, args = [], cwd = null) {
  const command = formatFfmpegCommand(binary, args, cwd);
  console.log('[FFMPEG START]', purpose, command);
  return command;
}
