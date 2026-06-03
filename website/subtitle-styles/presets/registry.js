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
      letterSpacing: '0',
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
      mode: 'score',
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
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: 700,
        fontSize: 'clamp(0.95rem, 3.6vw, 1.2rem)',
        lineHeight: 1.2,
        letterSpacing: '0'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ffffff',
        accent: '#ffffff',
        background: 'transparent',
        shadow: 'none'
      },
      layout: { mode: 'stack', wordsPerLineMin: 4, wordsPerLineMax: 10, align: 'center', maxWidth: '90%' },
      emphasis: { handler: 'minimal', mode: 'none' },
      motion: { cueEnter: 'fade', durationMs: 260, staggerMs: 0 },
      export: { ass: { primaryColour: '&H00FFFFFF&', fontsize: 38, outline: 2 } }
    }),
    hormozi: merge({
      id: 'hormozi',
      name: 'Alex Hormozi',
      tagline: 'Retention machine',
      mood: 'high-energy business',
      cardGradient: 'linear-gradient(135deg, #1a1408 0%, #3d3200 50%, #0d0d0d 100%)',
      typography: {
        fontFamily: '"Anton", "Impact", "Arial Black", sans-serif',
        fontWeight: 400,
        fontSize: 'clamp(1.35rem, 5.8vw, 2rem)',
        lineHeight: 1.1,
        letterSpacing: '0.125em',
        textTransform: 'uppercase'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ffe500',
        accent: '#ffe500',
        background: 'transparent',
        shadow: '3px 3px 0 rgba(0,0,0,0.6)'
      },
      layout: {
        mode: 'stack',
        wordsPerLineMin: 2,
        wordsPerLineMax: 4,
        maxCharsPerLine: 20,
        maxLines: 1,
        align: 'center',
        maxWidth: '88%'
      },
      emphasis: { handler: 'hormozi', mode: 'spokenWord' },
      motion: { cueEnter: 'pop', durationMs: 50, staggerMs: 0 },
      export: {
        ass: { primaryColour: '&H00FFFFFF&', secondaryColour: '&H0000E5FF&', bold: 1, fontsize: 76, outline: 4 }
      }
    }),
    mrbeast: merge({
      id: 'mrbeast',
      name: 'MrBeast',
      tagline: 'Viral dopamine',
      mood: 'YouTube entertainment',
      cardGradient: 'linear-gradient(135deg, #0d2840 0%, #1a6bff 40%, #ff2d55 100%)',
      typography: {
        fontFamily: '"Bangers", "Anton", "Arial Black", cursive',
        fontWeight: 400,
        fontSize: 'clamp(1.45rem, 6vw, 2.1rem)',
        lineHeight: 1.05,
        letterSpacing: '0.04em',
        textTransform: 'uppercase'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ff4444',
        accent: '#44aaff',
        background: 'rgba(0,0,0,0.55)',
        shadow: '0 2px 8px rgba(0,0,0,0.5)',
        wordCycle: ['#ff4444', '#ffe500', '#44ff88', '#44aaff']
      },
      layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 3, align: 'center', maxWidth: '88%' },
      emphasis: { handler: 'mrbeast', mode: 'cycleWords' },
      motion: { cueEnter: 'pop', durationMs: 50, staggerMs: 20 },
      export: {
        ass: { primaryColour: '&H00FFFFFF&', fontsize: 85, outline: 5, borderStyle: 3 }
      }
    }),
    'ali-abdaal': merge({
      id: 'ali-abdaal',
      name: 'Ali Abdaal Clean',
      tagline: 'Calm productivity',
      mood: 'smart calm creator',
      cardGradient: 'linear-gradient(145deg, #1a1d26 0%, #2d3748 100%)',
      typography: {
        fontFamily: '"Inter", "Poppins", system-ui, sans-serif',
        fontWeight: 600,
        fontSize: 'clamp(0.95rem, 3.8vw, 1.15rem)',
        lineHeight: 1.45,
        letterSpacing: '0.3px',
        textTransform: 'none'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ffffff',
        accent: '#94a3b8',
        background: 'rgba(0,0,0,0.55)',
        shadow: '0 2px 8px rgba(0,0,0,0.9)'
      },
      layout: { mode: 'wide', wordsPerLineMin: 6, wordsPerLineMax: 12, align: 'center', maxWidth: '92%' },
      emphasis: { handler: 'minimal', mode: 'none' },
      motion: { cueEnter: 'fade', durationMs: 420, staggerMs: 0 },
      export: { ass: { primaryColour: '&H00FFFFFF&', fontsize: 44, outline: 0, borderStyle: 3 } }
    }),
    'tiktok-neon': merge({
      id: 'tiktok-neon',
      name: 'TikTok Neon',
      tagline: 'Gen Z glow',
      mood: 'TikTok-native',
      cardGradient: 'linear-gradient(135deg, #0a0014 0%, #2d00ff 45%, #ff00aa 100%)',
      typography: {
        fontFamily: '"Montserrat", "Bebas Neue", "Arial Black", sans-serif',
        fontWeight: 800,
        fontSize: 'clamp(1.2rem, 5vw, 1.75rem)',
        lineHeight: 1.1,
        letterSpacing: '0.02em',
        textTransform: 'uppercase'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#00ffff',
        accent: '#ff00ff',
        background: 'transparent',
        shadow: 'none',
        neonColors: ['#00ffff', '#ff00ff']
      },
      layout: { mode: 'stack', wordsPerLineMin: 2, wordsPerLineMax: 4, align: 'center', maxWidth: '88%' },
      emphasis: { handler: 'neon', mode: 'spokenWord' },
      motion: { cueEnter: 'glow-in', durationMs: 300, staggerMs: 45 },
      export: {
        ass: { primaryColour: '&H00FFFFFF&', secondaryColour: '&H00FFFF00&', fontsize: 68, outline: 3 }
      }
    }),
    'luxury-minimal': merge({
      id: 'luxury-minimal',
      name: 'Luxury Minimal',
      tagline: 'Cinematic premium',
      mood: 'luxury brand',
      cardGradient: 'linear-gradient(145deg, #1c1814 0%, #3d3428 50%, #0a0a0a 100%)',
      typography: {
        fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
        fontWeight: 500,
        fontSize: 'clamp(1rem, 3.8vw, 1.25rem)',
        lineHeight: 1.4,
        letterSpacing: '0.2em',
        textTransform: 'uppercase'
      },
      colors: {
        text: '#f5f0e8',
        emphasis: '#f5f0e8',
        accent: '#c9b896',
        background: 'transparent',
        shadow: '0 1px 12px rgba(0,0,0,0.7)'
      },
      layout: { mode: 'stack', wordsPerLineMin: 4, wordsPerLineMax: 6, align: 'center', maxWidth: '86%' },
      emphasis: { handler: 'luxury', mode: 'none' },
      motion: { cueEnter: 'fade-slow', durationMs: 520, staggerMs: 60 },
      export: {
        ass: { primaryColour: '&H00E8F0F5&', fontsize: 38, outline: 0, spacing: 3 }
      }
    }),
    podcast: merge({
      id: 'podcast',
      name: 'Podcast',
      tagline: 'Interview clarity',
      mood: 'long-form clips',
      cardGradient: 'linear-gradient(145deg, #1a2332 0%, #2d3a4f 100%)',
      typography: {
        fontFamily: '"Lato", "SF Pro Display", system-ui, sans-serif',
        fontWeight: 600,
        fontSize: 'clamp(0.9rem, 3.5vw, 1.1rem)',
        lineHeight: 1.5,
        letterSpacing: '0',
        textTransform: 'none'
      },
      colors: {
        text: '#ffffff',
        emphasis: '#ffffff',
        accent: '#94a3b8',
        background: 'rgba(0,0,0,0.7)',
        shadow: 'none'
      },
      layout: { mode: 'wide', wordsPerLineMin: 8, wordsPerLineMax: 14, align: 'center', maxWidth: '80%' },
      emphasis: { handler: 'minimal', mode: 'none' },
      motion: { cueEnter: 'fade', durationMs: 480, staggerMs: 0 },
      export: { ass: { alignment: 2, fontsize: 40, outline: 2, borderStyle: 3 } }
    })
  };

  const ORDER = [
    'hormozi',
    'mrbeast',
    'ali-abdaal',
    'tiktok-neon',
    'luxury-minimal',
    'podcast',
    'clean-srt'
  ];

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
