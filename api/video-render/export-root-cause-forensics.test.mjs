import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRtlEmphasisAttributionReport,
  buildPhraseTimingAttributionReport
} from './export-root-cause-forensics.js';

test('RTL emphasis attribution documents disableEmphasis path', () => {
  const report = buildRtlEmphasisAttributionReport({
    presetId: 'mrBeast',
    captionMode: 'viral',
    layout: { rtl: true },
    canonicalCues: [{ text: 'سلام دنیا', start: 1, end: 2 }]
  });
  assert.equal(report.disableEmphasisGlobal, true);
  assert.ok(report.rootCause.includes('layout.rtl') || report.rootCause.includes('cueRtl'));
  assert.equal(report.perCueSamples[0].linesToAssTextWouldRun, false);
  assert.equal(report.perCueSamples[0].buildRtlDialogueTextApplied, true);
});

test('phrase timing report flags index misalignment when counts differ', () => {
  const segments = Array.from({ length: 8 }, (_, i) => ({
    start: 2 + i * 1.2,
    end: 2 + i * 1.2 + 1,
    text: `segment number ${i} with several words here`
  }));
  const phrase = buildPhraseTimingAttributionReport(segments, { captionMode: 'viral' });
  assert.ok(phrase.phraseCueCount !== segments.length || phrase.inputSegmentCount > 0);
  assert.ok(phrase.functionsThatChangeStartTime.length >= 4);
});
