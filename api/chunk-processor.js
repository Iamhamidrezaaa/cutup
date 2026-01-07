// Utility for processing large audio files by splitting into chunks
// Whisper API has a 25MB limit, so we split larger files

import FormDataLib from 'form-data';
import fetchModule from 'node-fetch';

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB - Whisper API limit
const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks (safe margin)

/**
 * Split audio file into chunks and transcribe each
 * @param {Buffer} audioBuffer - The audio file buffer
 * @param {string} mimeType - MIME type of the audio
 * @param {string} apiKey - OpenAI API key
 * @param {string} extension - File extension
 * @returns {Promise<{text: string, segments: Array, language: string}>}
 */
export async function transcribeLargeFile(audioBuffer, mimeType, apiKey, extension = 'mp3') {
  const fileSize = audioBuffer.length;
  
  // If file is small enough, process directly
  if (fileSize <= WHISPER_MAX_SIZE) {
    return await transcribeChunk(audioBuffer, mimeType, apiKey, extension);
  }
  
  console.log(`CHUNK_PROCESSOR: File is ${(fileSize / 1024 / 1024).toFixed(2)}MB, splitting into chunks...`);
  
  // Split into chunks
  const chunks = splitAudioIntoChunks(audioBuffer, CHUNK_SIZE);
  console.log(`CHUNK_PROCESSOR: Split into ${chunks.length} chunks`);
  
  // Transcribe chunks in parallel batches for faster processing
  // Process up to 3 chunks at a time to avoid rate limits
  const BATCH_SIZE = 3;
  const transcriptions = [];
  let detectedLanguage = null;
  
  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);
    
    console.log(`CHUNK_PROCESSOR: Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (chunks ${batchStart + 1}-${batchEnd} of ${chunks.length})...`);
    
    // Process batch in parallel
    const batchPromises = batch.map((chunk, batchIndex) => {
      const chunkIndex = batchStart + batchIndex;
      return transcribeChunk(chunk.buffer, mimeType, apiKey, extension).then(result => {
        // Adjust timestamps based on chunk offset (in seconds)
        const adjustedSegments = result.segments.map(segment => ({
          ...segment,
          start: segment.start + chunk.offset,
          end: segment.end + chunk.offset
        })).filter(segment => segment.end > segment.start); // Remove invalid segments
        
        return {
          text: result.text,
          segments: adjustedSegments,
          language: result.language,
          index: chunkIndex
        };
      });
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Store results in correct order
    for (const result of batchResults) {
      transcriptions.push(result);
      
      if (!detectedLanguage && result.language) {
        detectedLanguage = result.language;
      }
    }
  }
  
  // Sort by index to maintain order
  transcriptions.sort((a, b) => a.index - b.index);
  
  // Combine results
  const combinedText = transcriptions.map(t => t.text).join(' ');
  const combinedSegments = transcriptions.flatMap(t => t.segments).sort((a, b) => a.start - b.start);
  
  console.log(`CHUNK_PROCESSOR: Combined ${transcriptions.length} chunks, total segments: ${combinedSegments.length}`);
  
  return {
    text: combinedText,
    segments: combinedSegments,
    language: detectedLanguage || 'unknown'
  };
}

/**
 * Transcribe a single chunk
 */
async function transcribeChunk(audioBuffer, mimeType, apiKey, extension) {
  const fetch = fetchModule.default || fetchModule;
  
  const formData = new FormDataLib();
  formData.append('file', audioBuffer, {
    filename: `audio.${extension}`,
    contentType: mimeType,
    knownLength: audioBuffer.length
  });
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  
  const formHeaders = formData.getHeaders();
  
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...formHeaders
    },
    body: formData,
    timeout: 180000 // 3 minutes timeout (reduced for faster failure detection)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
  }
  
  const transcript = await response.json();
  
  return {
    text: transcript.text || '',
    segments: (transcript.segments && Array.isArray(transcript.segments)) ? transcript.segments : [],
    language: transcript.language || 'unknown'
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
      offset: timeOffset, // Time offset in seconds
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

