// Utility for processing large audio files by splitting into chunks
// Whisper-compatible APIs have a ~25MB limit, so we split larger files

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB — provider-side upload limit (approximate)
const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks (safe margin)

/**
 * Split audio file into chunks and transcribe each via injected provider callback (supports failover router).
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @param {string} extension
 * @param {(buf: Buffer, mt: string, ext: string) => Promise<{ text: string, segments: Array, language: string, languageConfidence?: number, provider?: string }>} transcribeOneChunk
 */
export async function transcribeLargeFile(audioBuffer, mimeType, extension = 'mp3', transcribeOneChunk) {
  const fileSize = audioBuffer.length;

  if (typeof transcribeOneChunk !== 'function') {
    throw new Error('transcribeLargeFile requires transcribeOneChunk(buffer, mimeType, extension)');
  }

  // If file is small enough, process directly
  if (fileSize <= WHISPER_MAX_SIZE) {
    return transcribeOneChunk(audioBuffer, mimeType, extension);
  }

  console.log(`CHUNK_PROCESSOR: File is ${(fileSize / 1024 / 1024).toFixed(2)}MB, splitting into chunks...`);

  const chunks = splitAudioIntoChunks(audioBuffer, CHUNK_SIZE);
  console.log(`CHUNK_PROCESSOR: Split into ${chunks.length} chunks`);

  const BATCH_SIZE = 1;
  const transcriptions = [];
  let detectedLanguage = null;
  let detectedLanguageConfidence = null;
  let detectedProvider = null;

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);

    console.log(
      `CHUNK_PROCESSOR: Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (chunks ${batchStart + 1}-${batchEnd} of ${chunks.length})...`
    );

    const batchPromises = batch.map((chunk, batchIndex) => {
      const chunkIndex = batchStart + batchIndex;
      return transcribeOneChunk(chunk.buffer, mimeType, extension).then((result) => {
        const adjustedSegments = result.segments
          .map((segment) => {
            const offset = chunk.offset;
            const words = Array.isArray(segment.words)
              ? segment.words.map((w) => ({
                  ...w,
                  start: Number(w.start) + offset,
                  end: Number(w.end) + offset
                }))
              : segment.words;
            return {
              ...segment,
              start: segment.start + offset,
              end: segment.end + offset,
              words
            };
          })
          .filter((segment) => segment.end > segment.start);

        return {
          text: result.text,
          segments: adjustedSegments,
          language: result.language,
          languageConfidence: result.languageConfidence,
          provider: result.provider,
          asrCapture: result.asrCapture || result.asrDiagnostics?.capture || null,
          index: chunkIndex,
          chunkOffsetSec: chunk.offset,
          chunkByteStart: chunk.byteStart ?? null,
          chunkByteLength: chunk.buffer?.length ?? null
        };
      });
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      transcriptions.push(result);

      if (!detectedLanguage && result.language) {
        detectedLanguage = result.language;
        detectedLanguageConfidence = result.languageConfidence ?? null;
        detectedProvider = result.provider ?? null;
      }
    }
  }

  transcriptions.sort((a, b) => a.index - b.index);

  const combinedText = transcriptions.map((t) => t.text).join(' ');
  const combinedSegments = transcriptions.flatMap((t) => t.segments).sort((a, b) => a.start - b.start);

  console.log(`CHUNK_PROCESSOR: Combined ${transcriptions.length} chunks, total segments: ${combinedSegments.length}`);

  const asrChunkCaptures = transcriptions
    .map((t) => t.asrCapture)
    .filter(Boolean);
  const asrChunkDiagnostics = transcriptions.map((t) => ({
    chunkIndex: t.index,
    timeOffsetSec: t.chunkOffsetSec,
    byteLength: t.chunkByteLength,
    providerId: t.provider || detectedProvider,
    segmentCount: Array.isArray(t.segments) ? t.segments.length : 0,
    textChars: t.text ? String(t.text).length : 0
  }));

  return {
    text: combinedText,
    segments: combinedSegments,
    language: detectedLanguage || 'unknown',
    languageConfidence: detectedLanguageConfidence,
    provider: detectedProvider,
    asrChunkCaptures,
    asrChunkDiagnostics,
    chunking: {
      fileSizeBytes: fileSize,
      chunkSizeBytes: CHUNK_SIZE,
      whisperMaxSizeBytes: WHISPER_MAX_SIZE,
      overlapBytes: 2 * 1024 * 1024,
      chunkCount: chunks.length,
      vadEnabled: false
    }
  };
}

/**
 * Split audio buffer into chunks with overlap to avoid cutting words
 * Note: This is a simple byte-level split. For better results, use ffmpeg to split at silence points
 * For MP3 files, we estimate ~1MB per minute of audio at 128kbps
 */
function splitAudioIntoChunks(audioBuffer, chunkSize) {
  const chunks = [];
  const totalSize = audioBuffer.length;
  const overlap = 2 * 1024 * 1024; // 2MB overlap to avoid cutting words
  
  // Estimate: ~1MB per minute for MP3 at 128kbps
  // This is rough, but Whisper will give us accurate timestamps
  const estimatedMBPerMinute = 1;
  const estimatedSecondsPerMB = 60;
  
  let offset = 0;
  let chunkIndex = 0;
  let timeOffset = 0; // Track time offset in seconds
  
  while (offset < totalSize) {
    const endOffset = Math.min(offset + chunkSize, totalSize);
    const chunkBuffer = audioBuffer.slice(offset, endOffset);
    
    // Estimate time offset based on file size
    // This is approximate - Whisper will give accurate timestamps
    const chunkSizeMB = chunkBuffer.length / (1024 * 1024);
    const estimatedChunkDuration = chunkSizeMB * estimatedSecondsPerMB;
    
    chunks.push({
      buffer: chunkBuffer,
      offset: timeOffset,
      byteStart: offset,
      index: chunkIndex++
    });
    
    // Update time offset (subtract overlap to avoid double counting)
    const overlapMB = overlap / (1024 * 1024);
    const overlapDuration = overlapMB * estimatedSecondsPerMB;
    timeOffset += estimatedChunkDuration - overlapDuration;
    
    // Move to next chunk with overlap
    offset = endOffset - overlap;
    if (offset >= totalSize) break;
  }
  
  console.log(`CHUNK_PROCESSOR: Split ${(totalSize / 1024 / 1024).toFixed(2)}MB into ${chunks.length} chunks`);
  return chunks;
}

/**
 * Better approach: Use ffmpeg to split at silence points (requires ffmpeg)
 * This would be more accurate but requires ffmpeg installation
 */
export async function splitAudioWithFFmpeg(audioPath, outputDir, chunkDuration = 600) {
  // This would use ffmpeg to split at silence points
  // Implementation would require ffmpeg binary
  // For now, we use simple byte-level splitting
  throw new Error('FFmpeg splitting not implemented yet. Using byte-level splitting.');
}

