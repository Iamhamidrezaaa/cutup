import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaptionForensicRows,
  buildCaptionForensicRootCause
} from './caption-forensics.js';

test('buildCaptionForensicRows maps preview and export timing', () => {
  const rows = buildCaptionForensicRows({
    transcriptSegments: [{ start: 2.1, end: 4.0, text: 'Hello world' }],
    exportInputSegments: [{ start: 2.1, end: 4.0, text: 'سلام دنیا' }],
    canonicalCues: [{ start: 2.19, end: 4.2, text: 'سلام دنیا', sourceStart: 2.19, sourceEnd: 4.2 }],
    assDialogues: [{ assStart: 2.19, assEnd: 4.2, text: 'سلام دنیا' }],
    exportSegmentedLines: [['سلام', 'دنیا']],
    previewRows: [
      {
        cueIndex: 0,
        previewStart: 2.1,
        previewEnd: 4.0,
        segmentedLines: ['سلام دنیا'],
        previewRenderer: 'CutupStyleRenderer'
      }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].originalStart, 2.1);
  assert.equal(rows[0].exportStart, 2.19);
  assert.equal(rows[0].segmentationMatch, false);
});

test('root cause flags whisper late first cue', () => {
  const rows = buildCaptionForensicRows({
    transcriptSegments: [{ start: 2.5, end: 4, text: 'Hi' }],
    exportInputSegments: [{ start: 2.5, end: 4, text: 'Hi' }],
    canonicalCues: [{ start: 2.59, end: 4.1, text: 'Hi' }],
    assDialogues: [{ assStart: 2.59, assEnd: 4.1 }]
  });
  const summary = buildCaptionForensicRootCause(rows, {});
  assert.match(summary.regressionFindings.firstSubtitleLate.likelyCause, /whisper_first_segment_late/);
});
