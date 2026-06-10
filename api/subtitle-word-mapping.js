/**
 * Subtitle integrity diagnostics — ordered word mapping across pipeline stages.
 * Does not alter transcription, translation, or rendering.
 */
import {
  cueWords,
  extractNormalizedWords,
  normalizeWordToken
} from './video-render/clean-srt-word-integrity.js';

function normalizeText(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

export function annotateSegmentsForMapping(segments, idPrefix = 'seg') {
  return (Array.isArray(segments) ? segments : [])
    .map((seg, index) => {
      if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number') return null;
      const text = normalizeText(seg.text);
      if (!text) return null;
      return {
        index,
        id: seg.id || `${idPrefix}-${index}`,
        start: roundSec(seg.start),
        end: roundSec(seg.end),
        text,
        locked: Boolean(seg.locked)
      };
    })
    .filter(Boolean);
}

/**
 * Flat ordered word stream with segment references.
 */
export function buildSegmentWordStream(segments, idPrefix = 'seg') {
  const annotated = annotateSegmentsForMapping(segments, idPrefix);
  const stream = [];
  let globalIndex = 0;
  for (const seg of annotated) {
    const rawWords = cueWords(seg.text);
    for (let wordIndexInSegment = 0; wordIndexInSegment < rawWords.length; wordIndexInSegment++) {
      const rawWord = rawWords[wordIndexInSegment];
      const word = normalizeWordToken(rawWord);
      if (!word) continue;
      stream.push({
        globalIndex,
        segmentId: seg.id,
        segmentIndex: seg.index,
        wordIndexInSegment,
        word,
        rawWord
      });
      globalIndex += 1;
    }
  }
  return { segments: annotated, stream };
}

/**
 * Greedy ordered alignment: each source word maps to next matching dest word.
 */
export function alignOrderedWordStreams(sourceStream, destStream) {
  const alignments = [];
  let destCursor = 0;
  for (const source of sourceStream) {
    let dest = null;
    let destIndex = null;
    for (let j = destCursor; j < destStream.length; j++) {
      if (destStream[j].word === source.word) {
        dest = destStream[j];
        destIndex = j;
        destCursor = j + 1;
        break;
      }
    }
    alignments.push({ source, dest, destIndex });
  }
  return alignments;
}

/**
 * Per source segment: which clean segments received its words.
 */
export function buildSegmentWordMappings(sourceSegments, destSegments, opts = {}) {
  const sourcePrefix = opts.sourcePrefix || 'source';
  const destPrefix = opts.destPrefix || 'dest';
  const { segments: sourceSegs, stream: sourceStream } = buildSegmentWordStream(
    sourceSegments,
    sourcePrefix
  );
  const { segments: destSegs, stream: destStream } = buildSegmentWordStream(destSegments, destPrefix);
  const alignments = alignOrderedWordStreams(sourceStream, destStream);

  const bySegmentId = new Map();
  for (const seg of sourceSegs) {
    bySegmentId.set(seg.id, {
      sourceSegmentId: seg.id,
      sourceSegmentIndex: seg.index,
      start: seg.start,
      end: seg.end,
      sourceText: seg.text,
      destinationSegmentIds: [],
      transferredWords: [],
      missingWords: []
    });
  }

  for (const { source, dest } of alignments) {
    const row = bySegmentId.get(source.segmentId);
    if (!row) continue;
    if (!dest) {
      row.missingWords.push({
        word: source.word,
        rawWord: source.rawWord,
        sourceWordIndex: source.wordIndexInSegment,
        sourceGlobalIndex: source.globalIndex
      });
      continue;
    }
    row.transferredWords.push({
      word: source.word,
      rawWord: source.rawWord,
      sourceWordIndex: source.wordIndexInSegment,
      sourceGlobalIndex: source.globalIndex,
      destinationSegmentId: dest.segmentId,
      destinationSegmentIndex: dest.segmentIndex,
      destinationWordIndex: dest.wordIndexInSegment,
      destinationGlobalIndex: dest.globalIndex
    });
    if (!row.destinationSegmentIds.includes(dest.segmentId)) {
      row.destinationSegmentIds.push(dest.segmentId);
    }
  }

  const segmentMappings = sourceSegs.map((seg) => {
    const row = bySegmentId.get(seg.id);
    const wordCount = row.transferredWords.length + row.missingWords.length;
    let status = 'fully_mapped';
    if (row.missingWords.length > 0) {
      status = row.transferredWords.length > 0 ? 'partially_lost' : 'fully_lost';
    } else if (row.destinationSegmentIds.length > 1) {
      status = 'redistributed';
    } else if (wordCount === 0) {
      status = 'empty';
    }
    return { ...row, status };
  });

  const destById = new Map(destSegs.map((s) => [s.id, s]));
  const lostSegments = segmentMappings.filter((m) => m.missingWords.length > 0);
  const redistributedSegments = segmentMappings.filter((m) => m.status === 'redistributed');

  return {
    sourceSegmentCount: sourceSegs.length,
    destSegmentCount: destSegs.length,
    sourceWordCount: sourceStream.length,
    destWordCount: destStream.length,
    globalWordsMatch:
      sourceStream.length === destStream.length &&
      sourceStream.every((s, i) => s.word === destStream[i]?.word),
    segmentMappings,
    lostSegments,
    redistributedSegments,
    destSegments: destSegs,
    destById
  };
}

/**
 * Stage diff using global word presence — redistribution is not loss.
 */
export function compareSegmentStagesByWordMapping(beforeSegments, afterSegments, opts = {}) {
  const mapping = buildSegmentWordMappings(beforeSegments, afterSegments, {
    sourcePrefix: opts.sourcePrefix || 'before',
    destPrefix: opts.destPrefix || 'after'
  });

  const removedSegments = [];
  const redistributedSegments = [];
  const mergedSegments = [];
  const shortenedSegments = [];

  for (const row of mapping.segmentMappings) {
    if (row.missingWords.length > 0) {
      const primaryDest = row.destinationSegmentIds[0] || null;
      const primaryDestSeg = primaryDest ? mapping.destById.get(primaryDest) : null;
      removedSegments.push({
        type: 'segment_text_lost',
        beforeIndex: row.sourceSegmentIndex,
        afterIndex: primaryDestSeg?.index ?? null,
        start: row.start,
        end: row.end,
        text: row.sourceText,
        afterText: primaryDestSeg?.text || null,
        reason: opts.reason || 'words_missing_in_destination_stage',
        missingWords: row.missingWords,
        transferredWords: row.transferredWords,
        destinationSegmentIds: row.destinationSegmentIds,
        wordMapping: row
      });
    } else if (row.status === 'redistributed') {
      redistributedSegments.push({
        type: 'segment_redistributed',
        beforeIndex: row.sourceSegmentIndex,
        start: row.start,
        end: row.end,
        text: row.sourceText,
        destinationSegmentIds: row.destinationSegmentIds,
        transferredWords: row.transferredWords,
        wordMapping: row
      });
    }
  }

  const before = annotateSegmentsForMapping(beforeSegments, 'before');
  const after = annotateSegmentsForMapping(afterSegments, 'after');

  function intervalsOverlap(a, b) {
    return Number(a.start) < Number(b.end) && Number(b.start) < Number(a.end);
  }

  for (const b of before) {
    const row = mapping.segmentMappings.find((m) => m.sourceSegmentIndex === b.index);
    if (row?.missingWords.length) continue;
    const overlaps = after.filter((a) => intervalsOverlap(b, a));
    if (!overlaps.length && row?.transferredWords.length) {
      redistributedSegments.push({
        type: 'segment_redistributed',
        beforeIndex: b.index,
        start: b.start,
        end: b.end,
        text: b.text,
        destinationSegmentIds: row.destinationSegmentIds,
        transferredWords: row.transferredWords,
        reason: 'timing_reshaped_words_preserved'
      });
      continue;
    }
    if (!overlaps.length && (!row || row.status === 'fully_lost' || row.status === 'empty')) {
      removedSegments.push({
        type: 'segment_removed',
        beforeIndex: b.index,
        start: b.start,
        end: b.end,
        text: b.text,
        reason: opts.reason || 'no_words_in_destination_stage',
        missingWords: row?.missingWords || [],
        wordMapping: row || null
      });
    }
  }

  for (const a of after) {
    const overlappingBefore = before.filter((b) => intervalsOverlap(b, a));
    if (overlappingBefore.length > 1) {
      mergedSegments.push({
        type: 'segment_merged',
        afterIndex: a.index,
        afterId: a.id,
        start: a.start,
        end: a.end,
        text: a.text,
        mergedFromCount: overlappingBefore.length,
        mergedFrom: overlappingBefore.map((b) => ({
          index: b.index,
          id: b.id,
          start: b.start,
          end: b.end,
          text: b.text
        }))
      });
    }
  }

  return {
    removedSegments,
    redistributedSegments,
    mergedSegments,
    shortenedSegments,
    wordMapping: mapping
  };
}

/**
 * Full pipeline diff: raw_provider → post_processed → clean_srt.
 */
export function buildPipelineWordDiffReport(opts = {}) {
  const { rawProvider = [], postProcessed = [], cleanSrt = [] } = opts;

  const rawToPostProcessed = compareSegmentStagesByWordMapping(rawProvider, postProcessed, {
    sourcePrefix: 'raw',
    destPrefix: 'post',
    reason: 'lost_during_post_processing'
  });

  const postProcessedToCleanSrt = compareSegmentStagesByWordMapping(postProcessed, cleanSrt, {
    sourcePrefix: 'post',
    destPrefix: 'clean',
    reason: 'lost_during_clean_srt'
  });

  const rawToCleanSrt = compareSegmentStagesByWordMapping(rawProvider, cleanSrt, {
    sourcePrefix: 'raw',
    destPrefix: 'clean',
    reason: 'lost_raw_to_clean_srt'
  });

  const segmentTextLost = [
    ...rawToPostProcessed.removedSegments.filter((r) => r.type === 'segment_text_lost'),
    ...postProcessedToCleanSrt.removedSegments.filter((r) => r.type === 'segment_text_lost'),
    ...rawToCleanSrt.removedSegments.filter((r) => r.type === 'segment_text_lost')
  ];

  return {
    rawToPostProcessed: {
      ...rawToPostProcessed,
      segmentMappings: rawToPostProcessed.wordMapping.segmentMappings
    },
    postProcessedToCleanSrt: {
      ...postProcessedToCleanSrt,
      segmentMappings: postProcessedToCleanSrt.wordMapping.segmentMappings
    },
    rawToCleanSrt: {
      ...rawToCleanSrt,
      segmentMappings: rawToCleanSrt.wordMapping.segmentMappings
    },
    segmentTextLost,
    redistributedSegments: [
      ...rawToPostProcessed.redistributedSegments,
      ...postProcessedToCleanSrt.redistributedSegments,
      ...rawToCleanSrt.redistributedSegments
    ]
  };
}

/**
 * Reconcile global wordLoss.ok with per-segment diagnostics.
 */
export function buildReconciledWordLossReport(postProcessed, cleanSrt, pipelineDiff) {
  const sourceWords = extractNormalizedWords(postProcessed);
  const cleanWords = extractNormalizedWords(cleanSrt);
  const globalMatch = sourceWords.join(' ') === cleanWords.join(' ');

  const postToClean = pipelineDiff?.postProcessedToCleanSrt;
  const trulyLostSegments = postToClean?.wordMapping?.lostSegments || [];
  const segmentTextLost = (pipelineDiff?.segmentTextLost || []).filter(
    (r) => r.type === 'segment_text_lost'
  );

  const missingWords = [];
  for (const seg of trulyLostSegments) {
    for (const mw of seg.missingWords) {
      missingWords.push({
        word: mw.word,
        sourceSegmentId: seg.sourceSegmentId,
        sourceSegmentIndex: seg.sourceSegmentIndex,
        sourceWordIndex: mw.sourceWordIndex,
        reason: 'not_found_in_clean_srt'
      });
    }
  }

  const ok = globalMatch && trulyLostSegments.length === 0 && segmentTextLost.length === 0;

  return {
    ok,
    globalWordsMatch: globalMatch,
    missingWords,
    missingCharacters: ok ? 0 : Math.max(0, sourceWords.join(' ').length - cleanWords.join(' ').length),
    missingSegments: trulyLostSegments.map((seg) => ({
      segmentId: seg.sourceSegmentId,
      segmentIndex: seg.sourceSegmentIndex,
      start: seg.start,
      end: seg.end,
      text: seg.sourceText,
      missingWords: seg.missingWords,
      destinationSegmentIds: seg.destinationSegmentIds,
      transferredWords: seg.transferredWords
    })),
    sourceWordCount: sourceWords.length,
    cleanWordCount: cleanWords.length,
    trulyLostSegmentCount: trulyLostSegments.length,
    segmentTextLostCount: segmentTextLost.length,
    redistributedSegmentCount: postToClean?.redistributedSegments?.length || 0
  };
}

/**
 * Artifact payload for subtitle_word_mapping.json
 */
export function buildSubtitleWordMappingArtifact(opts = {}) {
  const pipelineDiff = buildPipelineWordDiffReport(opts);
  const wordLoss = buildReconciledWordLossReport(
    opts.postProcessed || [],
    opts.cleanSrt || [],
    pipelineDiff
  );

  return {
    generatedAt: new Date().toISOString(),
    traceId: opts.traceId || null,
    wordLoss,
    pipeline: {
      rawToPostProcessed: {
        segmentMappings: pipelineDiff.rawToPostProcessed.segmentMappings,
        redistributedSegments: pipelineDiff.rawToPostProcessed.redistributedSegments,
        lostSegments: pipelineDiff.rawToPostProcessed.wordMapping.lostSegments
      },
      postProcessedToCleanSrt: {
        segmentMappings: pipelineDiff.postProcessedToCleanSrt.segmentMappings,
        redistributedSegments: pipelineDiff.postProcessedToCleanSrt.redistributedSegments,
        lostSegments: pipelineDiff.postProcessedToCleanSrt.wordMapping.lostSegments
      },
      rawToCleanSrt: {
        segmentMappings: pipelineDiff.rawToCleanSrt.segmentMappings,
        redistributedSegments: pipelineDiff.rawToCleanSrt.redistributedSegments,
        lostSegments: pipelineDiff.rawToCleanSrt.wordMapping.lostSegments
      }
    },
    segmentTextLost: pipelineDiff.segmentTextLost
  };
}
