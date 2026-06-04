/**
 * Video encoder selection — VPS defaults to libx264; GPU worker uses NVENC.
 */
export function resolveVideoEncoder() {
  const forced = String(process.env.VIDEO_RENDER_VIDEO_CODEC || '').trim().toLowerCase();
  if (forced === 'h264_nvenc' || forced === 'hevc_nvenc') return forced;
  if (String(process.env.GPU_RENDER_WORKER || '0') === '1') return 'h264_nvenc';
  return 'libx264';
}

export function isNvencCodec(codec) {
  return codec === 'h264_nvenc' || codec === 'hevc_nvenc';
}

/**
 * @param {string} codec
 * @param {object} enc from resolveEncodeProfile
 * @param {'fast'|'hq'} quality
 */
export function buildVideoEncodeArgs(codec, enc, quality = 'fast') {
  const maxrate = String(enc.maxrate || (quality === 'hq' ? '10M' : '6M'));
  const bufsize = String(enc.bufsize || (quality === 'hq' ? '16M' : '10M'));
  const gop = String(enc.gop || 48);
  const keyintMin = String(Math.max(24, Math.round((Number(enc.gop) || 48) * 0.5)));

  if (isNvencCodec(codec)) {
    const preset = String(process.env.VIDEO_RENDER_NVENC_PRESET || 'p4');
    const tune = String(process.env.VIDEO_RENDER_NVENC_TUNE || 'hq');
    const cq = String(
      process.env.VIDEO_RENDER_NVENC_CQ || (codec === 'hevc_nvenc' ? '26' : '23')
    );
    return [
      '-c:v',
      codec,
      '-preset',
      preset,
      '-tune',
      tune,
      '-rc',
      'vbr',
      '-cq',
      cq,
      '-b:v',
      '0',
      '-maxrate',
      maxrate,
      '-bufsize',
      bufsize,
      '-g',
      gop,
      '-keyint_min',
      keyintMin,
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p'
    ];
  }

  return [
    '-c:v',
    'libx264',
    '-preset',
    enc.preset,
    '-crf',
    String(enc.crf),
    '-maxrate',
    maxrate,
    '-bufsize',
    bufsize,
    '-g',
    gop,
    '-keyint_min',
    keyintMin,
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p'
  ];
}
