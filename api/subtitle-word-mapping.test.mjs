import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterCleanSrtFromSegments } from './video-render/master-subtitle-cues.js';
import {
  buildPipelineWordDiffReport,
  buildReconciledWordLossReport,
  buildSegmentWordMappings,
  buildSubtitleWordMappingArtifact,
  compareSegmentStagesByWordMapping
} from './subtitle-word-mapping.js';

const SPLIT_EXAMPLE =
  'What kidding challenge with you guys that lifting very nice. No, just challenge';

test('redistributed split does not produce segment_text_lost', () => {
  const postProcessed = [{ start: 0, end: 8, text: SPLIT_EXAMPLE }];
  const cleanSrt = buildMasterCleanSrtFromSegments(postProcessed, { shortForm: true });

  const diff = compareSegmentStagesByWordMapping(postProcessed, cleanSrt);
  const textLost = diff.removedSegments.filter((r) => r.type === 'segment_text_lost');
  assert.equal(textLost.length, 0);
  assert.equal(diff.redistributedSegments.length, 1);
  assert.equal(diff.redistributedSegments[0].destinationSegmentIds.length, 3);

  const mapping = buildSegmentWordMappings(postProcessed, cleanSrt);
  assert.equal(mapping.lostSegments.length, 0);
  assert.equal(mapping.globalWordsMatch, true);
  assert.equal(mapping.segmentMappings[0].transferredWords.length, 13);
});

test('word mapping shows destination clean_srt ids per source word', () => {
  const postProcessed = [{ start: 0, end: 8, text: SPLIT_EXAMPLE }];
  const cleanSrt = buildMasterCleanSrtFromSegments(postProcessed, { shortForm: true });
  const mapping = buildSegmentWordMappings(postProcessed, cleanSrt);
  const row = mapping.segmentMappings[0];

  assert.equal(row.sourceSegmentId, 'source-0');
  assert.equal(row.destinationSegmentIds.length, 3);
  assert.equal(row.transferredWords[0].word, 'what');
  assert.equal(row.transferredWords[0].destinationSegmentId, row.destinationSegmentIds[0]);
  assert.equal(row.transferredWords[5].word, 'guys');
  assert.equal(row.transferredWords[5].destinationSegmentId, row.destinationSegmentIds[1]);
  assert.equal(row.transferredWords[11].word, 'just');
  assert.equal(row.transferredWords[11].destinationSegmentId, row.destinationSegmentIds[2]);
});

test('reconciled wordLoss ok stays true when words only redistribute', () => {
  const postProcessed = [{ start: 0, end: 8, text: SPLIT_EXAMPLE }];
  const cleanSrt = buildMasterCleanSrtFromSegments(postProcessed, { shortForm: true });
  const pipelineDiff = buildPipelineWordDiffReport({ postProcessed, cleanSrt });
  const wordLoss = buildReconciledWordLossReport(postProcessed, cleanSrt, pipelineDiff);

  assert.equal(wordLoss.ok, true);
  assert.equal(wordLoss.segmentTextLostCount, 0);
  assert.equal(wordLoss.trulyLostSegmentCount, 0);
});

test('segment_text_lost forces wordLoss.ok false with word diagnostics', () => {
  const postProcessed = [{ start: 0, end: 2, text: 'one two three four' }];
  const cleanSrt = [{ start: 0, end: 1, text: 'one two' }];
  const pipelineDiff = buildPipelineWordDiffReport({ postProcessed, cleanSrt });
  const wordLoss = buildReconciledWordLossReport(postProcessed, cleanSrt, pipelineDiff);

  assert.equal(wordLoss.ok, false);
  assert.ok(wordLoss.missingWords.length >= 2);
  assert.equal(pipelineDiff.segmentTextLost.length, 1);
  assert.ok(pipelineDiff.segmentTextLost[0].missingWords.length >= 2);
  assert.ok(pipelineDiff.segmentTextLost[0].transferredWords.length >= 2);
});

test('buildSubtitleWordMappingArtifact includes full pipeline diff', () => {
  const raw = [{ start: 0, end: 8, text: SPLIT_EXAMPLE }];
  const postProcessed = raw;
  const cleanSrt = buildMasterCleanSrtFromSegments(postProcessed, { shortForm: true });
  const artifact = buildSubtitleWordMappingArtifact({
    traceId: 't-split',
    rawProvider: raw,
    postProcessed,
    cleanSrt
  });

  assert.equal(artifact.wordLoss.ok, true);
  assert.ok(artifact.pipeline.postProcessedToCleanSrt.segmentMappings.length === 1);
  assert.equal(artifact.pipeline.postProcessedToCleanSrt.redistributedSegments.length, 1);
  assert.equal(artifact.segmentTextLost.length, 0);
});

test('compareSegmentStagesByWordMapping detects fully removed segment words', () => {
  const before = [
    { start: 0, end: 1, text: 'first' },
    { start: 1.2, end: 2.2, text: 'missing later' }
  ];
  const after = [{ start: 0, end: 1, text: 'first' }];
  const diff = compareSegmentStagesByWordMapping(before, after);
  const lost = diff.removedSegments.filter((r) => r.type === 'segment_text_lost' || r.type === 'segment_removed');
  assert.ok(lost.length >= 1);
  assert.ok(lost.some((r) => String(r.text).includes('missing')));
});
