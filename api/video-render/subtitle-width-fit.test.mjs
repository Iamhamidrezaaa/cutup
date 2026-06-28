import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCueVisualChunks } from './subtitle-pipeline.js';
import { isRtlText } from './rtl-text.js';
import {
  resolveFittedFontSize,
  resolveFittedFontSizeForLines,
  splitWordsByCharBudget,
  cueNeedsVerticalSplit,
  clampLinesToSafeBand,
  maxSubtitleBandWidthPx
} from './subtitle-width-fit.js';

test('splitWordsByCharBudget breaks long English lines for vertical', () => {
  const words =
    'THIS KID WAS TAKING PART IN A CHALLENGE TO WIN A FREE HAIRCUT'.split(/\s+/);
  const chunks = splitWordsByCharBudget(words, 22);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.join(' ').length <= 24);
  }
});

test('expandCueVisualChunks splits vertical overflow even on short duration', () => {
  const input = [
    {
      id: 'srt-0',
      text: 'THIS KID WAS TAKING PART IN A CHALLENGE TO WIN',
      sourceStart: 0.5,
      sourceEnd: 1.8,
      renderStart: 0.5,
      renderEnd: 1.8
    }
  ];
  const out = expandCueVisualChunks(input, {
    isVertical: true,
    forceSplitOverflow: true,
    maxCharsPerChunk: 20,
    minDurToSplitSec: 0.5
  });
  assert.ok(out.length > 1);
});

test('resolveFittedFontSize shrinks font when line is too wide', () => {
  const fs = resolveFittedFontSize('THIS KID WAS TAKING PART IN A CHALLENGE', 76, 520, 32);
  assert.ok(fs < 76);
  assert.ok(fs >= 32);
});

test('resolveFittedFontSizeForLines uses widest row not average', () => {
  const shortLong = resolveFittedFontSizeForLines(
    ['OK', 'CHALLENGE DEADLIFTING VIDEOS'],
    76,
    520,
    32
  );
  const joined = resolveFittedFontSize('OK CHALLENGE DEADLIFTING VIDEOS', 76, 520, 32);
  assert.ok(shortLong <= joined);
});

test('expandCueVisualChunks does not split RTL cues on vertical overflow', () => {
  const ar =
    'هذا الشاب يشارك في تحدي كان طويل جدا ويجب ألا يقسم إلى أجزاء متعددة للعرض';
  assert.ok(isRtlText(ar));
  const input = [
    {
      id: 'srt-ar',
      text: ar,
      sourceStart: 0.5,
      sourceEnd: 1.8,
      renderStart: 0.5,
      renderEnd: 1.8
    }
  ];
  const out = expandCueVisualChunks(input, {
    isVertical: true,
    forceSplitOverflow: true,
    maxCharsPerChunk: 18,
    minDurToSplitSec: 0.5
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, ar);
});

test('clampLinesToSafeBand splits wide vertical rows without dropping words', () => {
  const maxW = maxSubtitleBandWidthPx(1080, 173, 173);
  const source = 'MUSIC IS CHANGING THIS FUCKING VIDEO';
  const lines = clampLinesToSafeBand([source], 85, maxW, 2);
  assert.ok(lines.length >= 1 && lines.length <= 2);
  const joined = lines.join(' ');
  assert.equal(joined.split(/\s+/).length, source.split(/\s+/).length);
});

test('cueNeedsVerticalSplit detects wide lines', () => {
  assert.ok(
    cueNeedsVerticalSplit('THIS KID WAS TAKING PART IN A CHALLENGE', {
      playResX: 1080,
      marginL: 54,
      marginR: 54,
      fontSize: 76,
      maxChars: 22
    })
  );
});
