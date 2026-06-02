import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhisperStarttimeForensicsReport } from './whisper-starttime-forensics.js';
import { buildRtlPhraseOrderForensicsReport } from './rtl-phrase-order-forensics.js';
import { generateAssContent } from './ass-generator.js';

test('whisper starttime report finds first change without blaming whisper', () => {
  const segments = [{ start: 1.79, end: 3.2, text: 'hello world', words: [{ word: 'hello', start: 1.79, end: 2.0 }] }];
  const report = buildWhisperStarttimeForensicsReport({
    exportSegments: segments,
    transcribeApiForensics: {
      whisperProviderRawFirst10: [{ segmentIndex: 0, segmentStartRawFromWhisper: 0.5, segmentEndRawFromWhisper: 2 }],
      afterValidFilterFirst10: [{ segmentIndex: 0, segmentStartRawFromWhisper: 1.79, segmentEndRawFromWhisper: 3.2 }]
    },
    segmentTimingLineage: [
      {
        functionName: 'transcribe.validSegmentsFilter',
        segments: [{ segmentIndex: 0, start: 1.79 }]
      }
    ]
  });
  assert.equal(report.first10Segments[0].rawWhisperSegmentStart, 0.5);
  assert.equal(report.first10Segments[0].finalSegmentStartUsedByPhrasePipeline, 1.79);
  assert.equal(report.rootCauseAttribution.firstChange?.functionName, 'transcribe.validSegmentsFilter');
});

test('rtl phrase order report runs on persian phrase', () => {
  const segments = [{ start: 0, end: 2, text: 'این کار سخته' }];
  const ass = generateAssContent(segments, 'mrBeast', { captionMode: 'viral' });
  const report = buildRtlPhraseOrderForensicsReport(segments, {
    assResult: ass,
    presetId: 'mrBeast',
    captionMode: 'viral'
  });
  assert.ok(Array.isArray(report.first20RtlPhraseCues));
});
