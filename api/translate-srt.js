// API endpoint for translating SRT subtitle files
// Uses GPT to translate subtitle text while preserving timing

import { handleCORS, setCORSHeaders } from './cors.js';
import OpenAI from 'openai';

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check API Key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('TRANSLATE_SRT_ERROR: OPENAI_API_KEY is not set');
      return res.status(500).json({ 
        error: 'OPENAI_ERROR', 
        details: 'API Key is not configured. Please set OPENAI_API_KEY in server .env file.' 
      });
    }

    const { srtContent, targetLanguage, sourceLanguage } = req.body;

    if (!srtContent || !targetLanguage) {
      return res.status(400).json({ error: 'srtContent and targetLanguage are required' });
    }

    console.log(`TRANSLATE_SRT: Translating SRT from ${sourceLanguage || 'auto'} to ${targetLanguage}`);

    // Parse SRT content
    const segments = parseSRT(srtContent);
    console.log(`TRANSLATE_SRT: Parsed ${segments.length} segments`);

    if (segments.length === 0) {
      return res.status(400).json({ error: 'No valid segments found in SRT content' });
    }

    // Translate segments using GPT
    const translatedSegments = await translateSegments(segments, targetLanguage, sourceLanguage, apiKey);

    // Reconstruct SRT file
    const translatedSRT = generateSRT(translatedSegments);

    console.log('TRANSLATE_SRT: Translation complete');

    setCORSHeaders(res);
    return res.status(200).json({
      srtContent: translatedSRT,
      segmentCount: translatedSegments.length,
      targetLanguage
    });

  } catch (error) {
    console.error('TRANSLATE_SRT_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'TRANSLATE_SRT_ERROR',
      details: error.message,
      message: 'SRT translation failed'
    });
  }
}

// Parse SRT content into segments
function parseSRT(srtContent) {
  const segments = [];
  const blocks = srtContent.trim().split(/\n\s*\n/);
  
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    
    // Skip index line (first line)
    const timeLine = lines[1];
    const textLines = lines.slice(2);
    
    const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!timeMatch) continue;
    
    const startTime = parseSRTTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endTime = parseSRTTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    const text = textLines.join(' ').trim();
    
    if (text.length > 0) {
      segments.push({ start: startTime, end: endTime, text });
    }
  }
  
  return segments;
}

// Parse SRT time format to seconds
function parseSRTTime(hours, minutes, seconds, milliseconds) {
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(milliseconds) / 1000;
}

// Translate segments using GPT
async function translateSegments(segments, targetLanguage, sourceLanguage, apiKey) {
  const client = new OpenAI({ apiKey });
  
  // Get language names
  const languageNames = {
    'fa': 'Persian/Farsi',
    'en': 'English',
    'ar': 'Arabic',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'ru': 'Russian',
    'tr': 'Turkish',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean'
  };
  
  const targetLangName = languageNames[targetLanguage] || targetLanguage;
  const sourceLangName = sourceLanguage ? (languageNames[sourceLanguage] || sourceLanguage) : 'the original language';
  
  // Batch translate segments (translate in chunks to avoid token limits)
  const batchSize = 20; // Translate 20 segments at a time
  const translatedSegments = [];
  
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchTexts = batch.map(s => s.text).join('\n---SEGMENT---\n');
    
    const systemPrompt = `You are a professional subtitle translator. Translate subtitle text accurately while preserving the meaning and context. Return only the translated text, one segment per line, separated by "---SEGMENT---". Do not add any explanations or formatting.`;
    
    const userPrompt = `Translate the following subtitle segments from ${sourceLangName} to ${targetLangName}. 
    
Return the translated text exactly as provided, with each segment on a separate line, separated by "---SEGMENT---". 
Preserve the meaning and keep the translation natural and accurate.

Subtitle segments:
${batchTexts}

Translated segments:`;
    
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: Math.min(batchTexts.length * 3, 4000)
      });
      
      const translatedText = completion.choices[0].message.content.trim();
      const translatedBatch = translatedText.split('---SEGMENT---').map(t => t.trim());
      
      // Map translated text back to segments
      for (let j = 0; j < batch.length && j < translatedBatch.length; j++) {
        translatedSegments.push({
          start: batch[j].start,
          end: batch[j].end,
          text: translatedBatch[j] || batch[j].text // Fallback to original if translation failed
        });
      }
      
      console.log(`TRANSLATE_SRT: Translated batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(segments.length / batchSize)}`);
    } catch (error) {
      console.error(`TRANSLATE_SRT: Error translating batch ${Math.floor(i / batchSize) + 1}:`, error.message);
      // Fallback: use original text for this batch
      translatedSegments.push(...batch);
    }
  }
  
  return translatedSegments;
}

// Generate SRT content from segments
function generateSRT(segments) {
  let srtContent = '';
  
  segments.forEach((segment, index) => {
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);
    srtContent += `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n\n`;
  });
  
  return srtContent;
}

// Format time in seconds to SRT format (HH:MM:SS,mmm)
function formatSRTTime(seconds) {
  const secs = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const secsPart = Math.floor(secs % 60);
  const milliseconds = Math.floor((secs % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secsPart).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

