/**
 * Server-side subtitle style presets for ASS + FFmpeg burn-in.
 * IDs align with website/subtitle-styles (kebab) and product names (camelCase).
 */

const PRESETS = {
  cleanSrt: {
    id: 'cleanSrt',
    name: 'Clean SRT',
    fontName: 'Arial',
    fontSize: 44,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H00FFFFFF&',
    outlineColor: '&H00000000&',
    backColor: '&H30000000&',
    bold: true,
    italic: false,
    outline: 2,
    shadow: 1,
    alignment: 2,
    marginV: 100,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    layout: { mode: 'stack', wordsPerLineMin: 3, wordsPerLineMax: 8 },
    emphasis: { handler: 'minimal', scalePercent: 102 },
    motion: { kinetic: false }
  },
  alexHormozi: {
    id: 'alexHormozi',
    name: 'Alex Hormozi',
    fontName: 'Arial',
    fontSize: 94,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H0000D7FF&',
    outlineColor: '&H00000000&',
    backColor: '&H80000000&',
    bold: true,
    italic: false,
    outline: 4,
    shadow: 2,
    alignment: 2,
    marginV: 290,
    playResX: 1080,
    playResY: 1920,
    uppercase: true,
    layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 5, maxCharsPerLine: 22, maxLines: 2 },
    positionMode: 'adaptive',
    emphasis: { handler: 'hormozi', scalePercent: 122, maxPerLine: 3 },
    motion: { kinetic: true }
  },
  mrBeast: {
    id: 'mrBeast',
    name: 'MrBeast',
    fontName: 'Arial',
    fontSize: 104,
    primaryColor: '&H00FFFFFF&',
    secondaryColor: '&H0000D7FF&',
    outlineColor: '&H00000000&',
    backColor: '&H20000000&',
    bold: true,
    italic: false,
    outline: 9,
    shadow: 4,
    alignment: 2,
    marginV: 286,
    playResX: 1080,
    playResY: 1920,
    uppercase: true,
    layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 4, maxCharsPerLine: 20, maxLines: 2 },
    emphasis: { handler: 'mrbeast', scalePercent: 122 },
    motion: { kinetic: true }
  },
  aliAbdaal: {
    id: 'aliAbdaal',
    name: 'Ali Abdaal',
    fontName: 'Arial',
    fontSize: 80,
    primaryColor: '&H001A1D26&',
    secondaryColor: '&H00EB6325&',
    outlineColor: '&H00FFFFFF&',
    backColor: '&H00F5F7FA&',
    bold: false,
    italic: false,
    outline: 0,
    shadow: 0,
    alignment: 2,
    marginV: 300,
    borderStyle: 3,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    layout: { mode: 'stack', wordsPerLineMin: 3, wordsPerLineMax: 5, maxCharsPerLine: 24, maxLines: 2 },
    emphasis: { handler: 'minimal', scalePercent: 105 },
    motion: { kinetic: false }
  },
  luxuryMinimal: {
    id: 'luxuryMinimal',
    name: 'Luxury Minimal',
    fontName: 'Georgia',
    fontSize: 88,
    primaryColor: '&H00E8F0F5&',
    secondaryColor: '&H0037AFD4&',
    outlineColor: '&H00000000&',
    backColor: '&H40000000&',
    bold: false,
    italic: false,
    outline: 2,
    shadow: 1,
    alignment: 2,
    marginV: 292,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    layout: { mode: 'stack', wordsPerLineMin: 3, wordsPerLineMax: 5, maxCharsPerLine: 22, maxLines: 2 },
    emphasis: { handler: 'luxury', scalePercent: 108 },
    motion: { kinetic: false }
  },
  podcast: {
    id: 'podcast',
    name: 'Podcast',
    fontName: 'Arial',
    fontSize: 76,
    primaryColor: '&H00F7F2EE&',
    secondaryColor: '&H00FCD37D&',
    outlineColor: '&H00000000&',
    backColor: '&H8015230F&',
    bold: false,
    italic: false,
    outline: 2,
    shadow: 1,
    alignment: 2,
    marginV: 304,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    layout: { mode: 'stack', wordsPerLineMin: 3, wordsPerLineMax: 5, maxCharsPerLine: 24, maxLines: 2 },
    emphasis: { handler: 'minimal', scalePercent: 106 },
    motion: { kinetic: false }
  },
  tiktokNeon: {
    id: 'tiktokNeon',
    name: 'TikTok Neon',
    fontName: 'Arial',
    fontSize: 96,
    primaryColor: '&H00FFF4F0&',
    secondaryColor: '&H00FFF500&',
    outlineColor: '&H00E500FF&',
    backColor: '&H800A0014&',
    bold: true,
    italic: false,
    outline: 3,
    shadow: 2,
    alignment: 2,
    marginV: 288,
    playResX: 1080,
    playResY: 1920,
    uppercase: false,
    layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 5, maxCharsPerLine: 22, maxLines: 2 },
    emphasis: { handler: 'neon', scalePercent: 115 },
    motion: { kinetic: true }
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
