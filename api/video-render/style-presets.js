/**
 * Server-side subtitle style presets for ASS + FFmpeg burn-in.
 * IDs align with website/subtitle-styles (kebab) and product names (camelCase).
 */

const PRESETS = {
  cleanSrt: {
    id: 'cleanSrt',
    name: 'Clean SRT',
    useFixedTypography: true,
    fontName: 'Arial',
    fontSize: 38,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H00FFFFFF&',
    outlineColor: '&H00000000&',
    backColor: '&H00000000&',
    bold: false,
    italic: false,
    outline: 2,
    shadow: 0,
    spacing: 0,
    scaleY: 100,
    alignment: 2,
    marginV: 100,
    borderStyle: 1,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    glow: 0,
    layout: { mode: 'stack', wordsPerLineMin: 4, wordsPerLineMax: 10, maxCharsPerLine: 42, maxLines: 2 },
    emphasis: { handler: 'minimal', mode: 'none', maxPerLine: 0 },
    motion: { kinetic: false }
  },
  alexHormozi: {
    id: 'alexHormozi',
    name: 'Alex Hormozi',
    useFixedTypography: true,
    fontName: 'Anton',
    fontSize: 76,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H0000E5FF&',
    outlineColor: '&H00000000&',
    backColor: '&H00000000&',
    bold: true,
    italic: false,
    outline: 4,
    shadow: 3,
    spacing: 2,
    scaleY: 110,
    alignment: 2,
    marginV: 290,
    borderStyle: 1,
    playResX: 1080,
    playResY: 1920,
    uppercase: true,
    glow: 0,
    layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 4, maxCharsPerLine: 18, maxLines: 2 },
    positionMode: 'adaptive',
    emphasis: { handler: 'hormozi', mode: 'spokenWord', maxPerLine: 1, highlightColor: '&H0000E5FF&' },
    motion: { kinetic: false }
  },
  mrBeast: {
    id: 'mrBeast',
    name: 'MrBeast',
    useFixedTypography: true,
    fontName: 'Bangers',
    fontSize: 85,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H0000E5FF&',
    outlineColor: '&H00000000&',
    backColor: '&HC8000000&',
    bold: true,
    italic: false,
    outline: 5,
    shadow: 2,
    spacing: 1,
    scaleY: 105,
    alignment: 2,
    marginV: 286,
    borderStyle: 3,
    playResX: 1080,
    playResY: 1920,
    uppercase: true,
    glow: 0,
    layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 3, maxCharsPerLine: 16, maxLines: 2 },
    emphasis: {
      handler: 'mrbeast',
      mode: 'cycleWords',
      wordColors: ['&H004444FF&', '&H0000E5FF&', '&H0088FF44&', '&H00FFAA44&']
    },
    motion: { kinetic: true }
  },
  aliAbdaal: {
    id: 'aliAbdaal',
    name: 'Ali Abdaal',
    useFixedTypography: true,
    fontName: 'Inter',
    fontSize: 44,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H00FFFFFF&',
    outlineColor: '&H00000000&',
    backColor: '&H8C000000&',
    bold: false,
    italic: false,
    outline: 0,
    shadow: 2,
    spacing: 0,
    scaleY: 100,
    alignment: 2,
    marginV: 300,
    borderStyle: 3,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    glow: 0,
    layout: { mode: 'wide', wordsPerLineMin: 6, wordsPerLineMax: 12, maxCharsPerLine: 42, maxLines: 2 },
    emphasis: { handler: 'minimal', mode: 'none', maxPerLine: 0 },
    motion: { kinetic: false }
  },
  tiktokNeon: {
    id: 'tiktokNeon',
    name: 'TikTok Neon',
    useFixedTypography: true,
    fontName: 'Montserrat',
    fontSize: 68,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H00FFFF00&',
    outlineColor: '&H00000000&',
    backColor: '&H00000000&',
    bold: true,
    italic: false,
    outline: 3,
    shadow: 0,
    spacing: 0,
    scaleY: 105,
    alignment: 2,
    marginV: 288,
    borderStyle: 1,
    playResX: 1080,
    playResY: 1920,
    uppercase: true,
    glow: 2.5,
    layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 4, maxCharsPerLine: 20, maxLines: 2 },
    emphasis: {
      handler: 'neon',
      mode: 'spokenWord',
      maxPerLine: 1,
      neonColors: ['&H00FFFF00&', '&H00FF00FF&']
    },
    motion: { kinetic: false }
  },
  luxuryMinimal: {
    id: 'luxuryMinimal',
    name: 'Luxury Minimal',
    useFixedTypography: true,
    fontName: 'Cormorant Garamond',
    fontSize: 38,
    primaryColor: '&H00E8F0F5&',
    secondaryColor: '&H00E8F0F5&',
    outlineColor: '&H00000000&',
    backColor: '&H00000000&',
    bold: false,
    italic: false,
    outline: 0,
    shadow: 2,
    spacing: 3,
    scaleY: 140,
    alignment: 2,
    marginV: 292,
    borderStyle: 1,
    playResX: 1080,
    playResY: 1920,
    uppercase: true,
    glow: 0,
    layout: { mode: 'stack', wordsPerLineMin: 4, wordsPerLineMax: 6, maxCharsPerLine: 28, maxLines: 2 },
    emphasis: { handler: 'luxury', mode: 'none', maxPerLine: 0 },
    motion: { kinetic: false }
  },
  podcast: {
    id: 'podcast',
    name: 'Podcast',
    useFixedTypography: true,
    fontName: 'Lato',
    fontSize: 40,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H00FFFFFF&',
    outlineColor: '&H00000000&',
    backColor: '&HB3000000&',
    bold: false,
    italic: false,
    outline: 2,
    shadow: 1,
    spacing: 0,
    scaleY: 150,
    alignment: 2,
    marginV: 304,
    borderStyle: 3,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    glow: 0,
    layout: { mode: 'wide', wordsPerLineMin: 6, wordsPerLineMax: 14, maxCharsPerLine: 48, maxLines: 2, maxWidthRatio: 0.8 },
    emphasis: { handler: 'minimal', mode: 'none', maxPerLine: 0 },
    motion: { kinetic: false }
  }
};

const ALIASES = {
  clean: 'cleanSrt',
  cleansrt: 'cleanSrt',
  'clean-srt': 'cleanSrt',
  hormozi: 'alexHormozi',
  'alex-hormozi': 'alexHormozi',
  mrbeast: 'mrBeast',
  'mr-beast': 'mrBeast',
  'ali-abdaal': 'aliAbdaal',
  'luxury-minimal': 'luxuryMinimal',
  'tiktok-neon': 'tiktokNeon'
};

function presetNotAppliedError(raw) {
  const err = new Error(`PRESET_NOT_APPLIED: ${String(raw || '').trim() || 'missing_preset_id'}`);
  err.code = 'PRESET_NOT_APPLIED';
  return err;
}

export function resolvePresetIdOrThrow(raw) {
  const input = String(raw || '').trim();
  if (!input) throw presetNotAppliedError(raw);
  if (PRESETS[input]) return input;

  const lower = input.toLowerCase();
  if (PRESETS[lower]) return lower;
  if (ALIASES[input]) return ALIASES[input];
  if (ALIASES[lower]) return ALIASES[lower];

  const kebab = input
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
  if (ALIASES[kebab]) return ALIASES[kebab];
  if (PRESETS[kebab]) return kebab;

  throw presetNotAppliedError(raw);
}

export function normalizePresetId(raw) {
  try {
    return resolvePresetIdOrThrow(raw || 'alexHormozi');
  } catch {
    return 'alexHormozi';
  }
}

export function getStylePreset(presetId) {
  const id = resolvePresetIdOrThrow(presetId);
  return { ...PRESETS[id] };
}

export function listStylePresets() {
  return Object.values(PRESETS).map((p) => ({ id: p.id, name: p.name }));
}

export { PRESETS };
