import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proveSegmentationSplit,
  buildFirstSubtitleDelayEvidence,
  buildCaptionForensicRecords
} from './caption-forensics.js';

test('proveSegmentationSplit names preview chunkWords vs export legacyStack', () => {
  const proof = proveSegmentationSplit('این بچه تو یه چالش شرکت کرده بود...');
  assert.equal(proof.preview.functionChain[1], 'chunkWords');
  assert.equal(proof.export.functionChain[0], 'layoutLinesLegacyStack');
  assert.ok(Array.isArray(proof.preview.lines));
  assert.ok(Array.isArray(proof.export.lines));
});

test('first subtitle delay evidence attributes Whisper when start > 1s', () => {
  const evidence = buildFirstSubtitleDelayEvidence({
    whisperSegments: [{ start: 2.2, end: 4, text: 'hello' }],
    exportInputSegments: [{ start: 2.2, end: 4, text: 'hello' }],
    pipelineAudit: {
      parsedCount: 1,
      afterRollingMergeCount: 1,
      afterCoalesceCount: 1,
      afterStabilizeCount: 1,
      parsed: [{ start: 2.2, end: 4, text: 'hello' }],
      afterRollingMerge: [{ start: 2.2, end: 4, text: 'hello' }],
      afterCoalesce: [{ start: 2.2, end: 4, text: 'hello' }],
      afterStabilize: [{ start: 2.29, end: 4.5, text: 'hello' }]
    },
    assDialogues: [{ assStart: 2.29, assEnd: 4.5, text: 'hello' }]
  });
  assert.equal(evidence.introducedAtStage, 'Whisper');
  assert.equal(evidence.whisperFirstStartSec, 2.2);
});

test('caption forensic record schema', () => {
  const records = buildCaptionForensicRecords({
    whisperSegments: [{ start: 0, end: 1, text: 'a' }],
    exportInputSegments: [{ start: 0, end: 1, text: 'b' }],
    canonicalCues: [{ start: 0.09, end: 1.2, text: 'b' }],
    assDialogues: [{ assStart: 0.09, assEnd: 1.2, text: 'b' }]
  });
  assert.equal(records[0].segmentIndex, 0);
  assert.equal(records[0].assDialogueStart, 0.09);
});
