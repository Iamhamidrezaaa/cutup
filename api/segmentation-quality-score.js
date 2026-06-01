/**
 * Compare legacy char/word stack layout vs semantic segmentation; pick higher score.
 */

import { segmentCaptionSemantically, scoreSegmentation, tokenizeCaptionText } from './semantic-caption-segmentation.js';
import {
  logSegmentationComparison,
  logSemanticSegmentationDisabled
} from './segmentation-telemetry.js';
import { persistSegmentationTrainingData } from './segmentation-training-data.js';

/** Legacy stack split (mirrors text-layout splitSemanticStack output shape). */
export function legacyStackLineParts(text, layout) {
  const w = tokenizeCaptionText(text);
  if (!w.length) return [[]];

  const min = Math.max(1, layout.wordsPerLineMin || 2);
  const max = Math.max(min, layout.wordsPerLineMax || 6);
  const maxChars = Math.max(8, layout.maxCharsPerLine || 36);

  const WEAK = new Set([
    'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with',
    'and', 'or', 'but', 'so', 'if', 'as', 'by'
  ]);

  const norm = (t) =>
    String(t.word || '')
      .toLowerCase()
      .replace(/^[^\w]+|[^\w]+$/g, '');
  const lineLen = (parts) => parts.map((t) => t.raw).join(' ').length;
  const endsPause = (t) => /[.!?,:;]$/.test(`${t.word}${t.punct}`);

  const lines = [];
  let line = [];

  for (let i = 0; i < w.length; i++) {
    const token = w[i];
    const next = w[i + 1];
    const preview = [...line, token];
    const shouldBreak = preview.length >= min && endsPause(token);
    const hitWordCap = preview.length >= max;
    const hitCharCap = lineLen(preview) >= maxChars && preview.length >= min;
    const safeEdge =
      preview.length >= min &&
      !WEAK.has(norm(preview[preview.length - 1])) &&
      (!next || !WEAK.has(norm(next)));

    line.push(token);
    if ((shouldBreak || hitWordCap || hitCharCap) && safeEdge) {
      lines.push(line);
      line = [];
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [w];
}

export function legacyStackToLines(text, layout) {
  return legacyStackLineParts(text, layout)
    .map((parts) => parts.map((t) => t.raw).join(' ').trim())
    .filter(Boolean);
}

/**
 * Score a line split for A/B comparison.
 */
export function scoreLayoutLines(lineStrings, tokens, domain, layout = {}) {
  const parts = [];
  let idx = 0;
  for (const ls of lineStrings) {
    const count = ls.split(/\s+/).filter(Boolean).length;
    parts.push(tokens.slice(idx, idx + count));
    idx += count;
  }
  if (idx < tokens.length && parts.length) {
    parts[parts.length - 1] = [...parts[parts.length - 1], ...tokens.slice(idx)];
  }
  return scoreSegmentation(parts, tokens, domain, layout).score;
}

/** Production output may use semantic splits only when explicitly enabled. Default: off. */
export function isSemanticSegmentationProductionEnabled() {
  return String(process.env.SEMANTIC_SEGMENTATION_PRODUCTION ?? '0') === '1';
}

/** Shadow evaluation (scores + telemetry only). Default: on. */
export function isSemanticSegmentationEvalEnabled() {
  if (String(process.env.SEMANTIC_SEGMENTATION_EVAL ?? '1') === '0') return false;
  return true;
}

/** @deprecated use isSemanticSegmentationProductionEnabled */
export function isSemanticSegmentationEnabled() {
  return isSemanticSegmentationProductionEnabled();
}

/**
 * Evaluation-only: build currentVersion + semanticVersion, score both; never changes production lines.
 * @param {string} text
 * @param {object} layout
 * @param {{ language?, domain?, traceId?, persistTraining?, currentVersion? }} [opts]
 */
export function evaluateSegmentationShadow(text, layout, opts = {}) {
  const language = opts.language || 'unknown';
  const domain = opts.domain || 'general';
  const tokens = tokenizeCaptionText(text);

  const currentVersion =
    Array.isArray(opts.currentVersion) && opts.currentVersion.length
      ? opts.currentVersion
      : legacyStackToLines(text, layout);
  const semantic = segmentCaptionSemantically({ text, language, domain, layout });
  const semanticVersion = semantic.lines;

  const currentScore = scoreLayoutLines(currentVersion, tokens, domain, layout);
  const semanticScore = scoreLayoutLines(semanticVersion, tokens, domain, layout);
  const wouldHaveWon = semanticScore > currentScore;

  const comparison = {
    currentScore,
    semanticScore,
    wouldHaveWon,
    currentVersion,
    semanticVersion,
    semanticLines: semanticVersion,
    legacyLines: currentVersion,
    breakReason: semantic.breakReason
  };

  if (opts.traceId) {
    logSemanticSegmentationDisabled(opts.traceId, {
      currentScore,
      semanticScore,
      wouldHaveWon,
      currentVersion,
      semanticVersion,
      language,
      domain
    });
  }

  if (opts.persistTraining !== false) {
    persistSegmentationTrainingData(
      [
        {
          language,
          domain,
          text,
          chosenLines: currentVersion,
          score: currentScore,
          breakReason: semantic.breakReason,
          selectedVersion: 'legacy',
          currentScore,
          semanticScore,
          wouldHaveWon
        }
      ],
      opts.traceId
    );
  }

  return comparison;
}

/**
 * Production path when SEMANTIC_SEGMENTATION_PRODUCTION=1 only.
 */
export function compareAndSelectSegmentation(text, layout, opts = {}) {
  const language = opts.language || 'unknown';
  const domain = opts.domain || 'general';
  const tokens = tokenizeCaptionText(text);

  const legacyLines = legacyStackToLines(text, layout);
  const semantic = segmentCaptionSemantically({ text, language, domain, layout });

  const currentScore = scoreLayoutLines(legacyLines, tokens, domain, layout);
  const semanticScore = scoreLayoutLines(semantic.lines, tokens, domain, layout);
  const selectedVersion = semanticScore >= currentScore ? 'semantic' : 'legacy';
  const lines = selectedVersion === 'semantic' ? semantic.lines : legacyLines;

  const comparison = {
    currentScore,
    semanticScore,
    selectedVersion,
    wouldHaveWon: semanticScore > currentScore,
    lines,
    currentVersion: legacyLines,
    semanticVersion: semantic.lines,
    legacyLines,
    semanticLines: semantic.lines,
    breakReason: semantic.breakReason
  };

  if (opts.traceId) {
    logSegmentationComparison(opts.traceId, {
      currentScore,
      semanticScore,
      selectedVersion,
      language,
      domain
    });
  }

  if (opts.persistTraining !== false) {
    persistSegmentationTrainingData(
      [
        {
          language,
          domain,
          text,
          chosenLines: lines,
          score: selectedVersion === 'semantic' ? semanticScore : currentScore,
          breakReason: semantic.breakReason,
          selectedVersion,
          currentScore,
          semanticScore,
          wouldHaveWon: comparison.wouldHaveWon
        }
      ],
      opts.traceId
    );
  }

  return comparison;
}
