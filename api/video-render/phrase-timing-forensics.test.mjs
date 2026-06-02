import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhraseTimingForensicsReport } from './phrase-timing-forensics.js';
import { generateAssContent } from './ass-generator.js';

test('phrase timing forensics produces first 20 rows with deltas', () => {
  const segments = Array.from({ length: 12 }, (_, i) => ({
    start: 1.5 + i * 0.55,
    end: 1.5 + i * 0.55 + 0.5,
    text: `word block ${i} here now`,
    words: [
      { word: 'word', start: 1.5 + i * 0.55, end: 1.5 + i * 0.55 + 0.12 },
      { word: 'block', start: 1.5 + i * 0.55 + 0.12, end: 1.5 + i * 0.55 + 0.24 },
      { word: String(i), start: 1.5 + i * 0.55 + 0.24, end: 1.5 + i * 0.55 + 0.36 },
      { word: 'here', start: 1.5 + i * 0.55 + 0.36, end: 1.5 + i * 0.55 + 0.48 },
      { word: 'now', start: 1.5 + i * 0.55 + 0.48, end: 1.5 + i * 0.55 + 0.5 }
    ]
  }));
  const assResult = generateAssContent(segments, 'mrBeast', { captionMode: 'viral' });
  const report = buildPhraseTimingForensicsReport(segments, {
    assResult,
    captionMode: 'viral'
  });
  assert.ok(report.first20PhraseCues.length > 0);
  assert.ok(report.first20PhraseCues.length <= 20);
  assert.ok(report.firstPhraseForensic.deltaFromFirstWordStartMs);
  assert.ok(report.delayAttribution.attributedFunction);
});
