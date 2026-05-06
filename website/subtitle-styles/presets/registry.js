/**
 * Subtitle style preset registry — structured for DOM preview + future ASS/FFmpeg export.
 * @typedef {object} SubtitleStylePreset
 */
(function (global) {
  'use strict';

  const base = {
    version: 1,
    typography: {
      fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
      fontWeight: 700,
      fontSize: 'clamp(1rem, 4.2vw, 1.35rem)',
      lineHeight: 1.15,
      letterSpacing: '-0.02em',
      textTransform: 'none'
    },
    colors: {
      text: '#ffffff',
      background: 'transparent',
      emphasis: '#ffd60a',
      accent: '#ffffff',
      shadow: '0 2px 12px rgba(0,0,0,0.45)'
    },
    layout: {
      mode: 'stack',
      wordsPerLineMin: 3,
      wordsPerLineMax: 6,
      align: 'center',
      maxWidth: '92%'
    },
    emphasis: {
      handler: 'default',
      powerWeight: 1,
      emotionalWeight: 1
    },
    motion: {
      cueEnter: 'fade-up',
      durationMs: 320,
      staggerMs: 40
    },
    export: {
      format: 'cutup-style-v1',
      ass: { playResX: 1080, playResY: 1920, alignment: 2 },
      ffmpeg: { force_style: '' }
    }
  };

  function merge(partial) {
    return {
      ...base,
      ...partial,
      typography: { ...base.typography, ...partial.typography },
      colors: { ...base.colors, ...partial.colors },
      layout: { ...base.layout, ...partial.layout },
      emphasis: { ...base.emphasis, ...partial.emphasis },
      motion: { ...base.motion, ...partial.motion },
      export: { ...base.export, ...partial.export }
    };
  }

  const PRESETS = {
    'clean-srt': merge({
      id: 'clean-srt',
      name: 'Clean SRT',
      tagline: 'Maximum readability',
      mood: 'clear stable captions',
      cardGradient: 'linear-gradient(145deg, #1a1f2b 0%, #2d3748 100%)',
      typography: {
        fontWeight: 800,
        fontSize: 'clamp(1.1rem, 4.4vw, 1.5rem)',
        lineHeight: 1.2,
        letterSpacing: '0'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ffffff',
        accent: '#d1d5db',
        background: 'rgba(0,0,0,0.55)',
        shadow: '0 3px 14px rgba(0,0,0,0.5)'
      },
      layout: { mode: 'stack', wordsPerLineMin: 3, wordsPerLineMax: 8, align: 'center', maxWidth: '90%' },
      emphasis: { handler: 'minimal' },
      motion: { cueEnter: 'fade', durationMs: 260, staggerMs: 0 },
      export: { ass: { primaryColour: '&H00FFFFFF&', secondaryColour: '&H00FFFFFF&', fontsize: 44 } }
    }),
    hormozi: merge({
      id: 'hormozi',
      name: 'Alex Hormozi',
      tagline: 'Retention machine',
      mood: 'high-energy business',
      cardGradient: 'linear-gradient(135deg, #1a1408 0%, #3d3200 50%, #0d0d0d 100%)',
      typography: {
        fontFamily: '"Inter", "Arial Black", sans-serif',
        fontWeight: 900,
        fontSize: 'clamp(1.15rem, 5vw, 1.65rem)',
        lineHeight: 1.05,
        letterSpacing: '-0.03em',
        textTransform: 'uppercase'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ffd60a',
        accent: '#ff453a',
        background: 'rgba(0,0,0,0.55)'
      },
      layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 4, align: 'center' },
      emphasis: { handler: 'hormozi' },
      motion: { cueEnter: 'pop', durationMs: 220, staggerMs: 28 },
      export: {
        ass: { primaryColour: '&H00FFFF&', secondaryColour: '&H0000D7FF&', bold: 1, fontsize: 52 }
      }
    }),
    mrbeast: merge({
      id: 'mrbeast',
      name: 'MrBeast',
      tagline: 'Viral dopamine',
      mood: 'YouTube entertainment',
      cardGradient: 'linear-gradient(135deg, #0d2840 0%, #1a6bff 40%, #ff2d55 100%)',
      typography: {
        fontWeight: 900,
        fontSize: 'clamp(1.2rem, 5.5vw, 1.85rem)',
        lineHeight: 1.08,
        letterSpacing: '-0.02em'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#00ff88',
        accent: '#ff2d55',
        background: 'rgba(0,20,60,0.5)'
      },
      layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 3, align: 'center' },
      emphasis: { handler: 'mrbeast' },
      motion: { cueEnter: 'burst', durationMs: 280, staggerMs: 35 },
      export: {
        ass: { primaryColour: '&H00FFFFFF&', secondaryColour: '&H0000FF88&', fontsize: 58 }
      }
    }),
    'ali-abdaal': merge({
      id: 'ali-abdaal',
      name: 'Ali Abdaal Clean',
      tagline: 'Calm productivity',
      mood: 'smart calm creator',
      cardGradient: 'linear-gradient(145deg, #f5f7fa 0%, #e8ecf2 100%)',
      typography: {
        fontWeight: 500,
        fontSize: 'clamp(0.95rem, 3.8vw, 1.2rem)',
        lineHeight: 1.45,
        letterSpacing: '0.01em'
      },
      colors: {
        text: '#1a1d26',
        emphasis: '#2563eb',
        accent: '#64748b',
        background: 'rgba(255,255,255,0.92)',
        shadow: '0 1px 8px rgba(0,0,0,0.08)'
      },
      layout: { mode: 'single', wordsPerLineMin: 6, wordsPerLineMax: 12, align: 'center' },
      emphasis: { handler: 'minimal' },
      motion: { cueEnter: 'fade', durationMs: 420, staggerMs: 0 },
      export: { ass: { primaryColour: '&H001A1D26&', fontsize: 38 } }
    }),
    'tiktok-neon': merge({
      id: 'tiktok-neon',
      name: 'TikTok Neon',
      tagline: 'Gen Z glow',
      mood: 'TikTok-native',
      cardGradient: 'linear-gradient(135deg, #0a0014 0%, #2d00ff 45%, #ff00aa 100%)',
      typography: {
        fontWeight: 800,
        fontSize: 'clamp(1.05rem, 4.5vw, 1.45rem)',
        lineHeight: 1.12,
        letterSpacing: '0.02em'
      },
      colors: {
        text: '#f0f4ff',
        emphasis: '#00f5ff',
        accent: '#ff00e5',
        background: 'rgba(10,0,30,0.65)'
      },
      layout: { mode: 'stack', wordsPerLineMin: 3, wordsPerLineMax: 5, align: 'center' },
      emphasis: { handler: 'neon' },
      motion: { cueEnter: 'glow-in', durationMs: 300, staggerMs: 45 },
      export: {
        ass: { primaryColour: '&H00F0F4FF&', secondaryColour: '&H00FFF500&', outline: 2 }
      }
    }),
    'luxury-minimal': merge({
      id: 'luxury-minimal',
      name: 'Luxury Minimal',
      tagline: 'Cinematic premium',
      mood: 'luxury brand',
      cardGradient: 'linear-gradient(145deg, #1c1814 0%, #3d3428 50%, #0a0a0a 100%)',
      typography: {
        fontFamily: '"Georgia", "Times New Roman", serif',
        fontWeight: 400,
        fontSize: 'clamp(1rem, 4vw, 1.35rem)',
        lineHeight: 1.5,
        letterSpacing: '0.06em',
        textTransform: 'none'
      },
      colors: {
        text: '#f5f0e8',
        emphasis: '#d4af37',
        accent: '#c9b896',
        background: 'rgba(0,0,0,0.35)'
      },
      layout: { mode: 'stack', wordsPerLineMin: 4, wordsPerLineMax: 6, align: 'center' },
      emphasis: { handler: 'luxury' },
      motion: { cueEnter: 'fade-slow', durationMs: 520, staggerMs: 60 },
      export: {
        ass: { primaryColour: '&H00E8F0F5&', secondaryColour: '&H0037AFD4&', fontsize: 42 }
      }
    }),
    podcast: merge({
      id: 'podcast',
      name: 'Podcast',
      tagline: 'Interview clarity',
      mood: 'long-form clips',
      cardGradient: 'linear-gradient(145deg, #1a2332 0%, #2d3a4f 100%)',
      typography: {
        fontWeight: 600,
        fontSize: 'clamp(0.92rem, 3.6vw, 1.15rem)',
        lineHeight: 1.55,
        letterSpacing: '0'
      },
      colors: {
        text: '#eef2f7',
        emphasis: '#7dd3fc',
        accent: '#94a3b8',
        background: 'rgba(15,23,42,0.75)'
      },
      layout: { mode: 'wide', wordsPerLineMin: 8, wordsPerLineMax: 12, align: 'center', maxWidth: '96%' },
      emphasis: { handler: 'minimal' },
      motion: { cueEnter: 'fade', durationMs: 480, staggerMs: 0 },
      export: { ass: { alignment: 2, fontsize: 36 } }
    })
  };

  const ORDER = ['hormozi', 'mrbeast', 'ali-abdaal', 'tiktok-neon', 'luxury-minimal', 'podcast'];

  function getPreset(id) {
    return PRESETS[id] || PRESETS.hormozi;
  }

  function listPresets() {
    return ORDER.map((id) => PRESETS[id]);
  }

  global.CutupStylePresets = {
    getPreset,
    listPresets,
    PRESETS,
    DEFAULT_PRESET_ID: 'hormozi'
  };
})(typeof window !== 'undefined' ? window : globalThis);
