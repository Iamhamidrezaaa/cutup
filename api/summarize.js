// API endpoint for summarizing text using GPT
// Deploy this to Vercel as a serverless function

import OpenAI from 'openai';
import { handleCORS, setCORSHeaders } from './cors.js';

// Initialize OpenAI client
// Note: API key will be set dynamically in handler to ensure it's always current
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export default async function handler(req, res) {
  // Handle CORS - باید اولین کاری باشد
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return; // OPTIONS request handled

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check API Key
    const apiKey = process.env.OPENAI_API_KEY;
    console.log('SUMMARIZE: API Key check:', apiKey ? `Present (${apiKey.substring(0, 10)}...)` : 'MISSING');
    
    if (!apiKey) {
      console.error('SUMMARIZE_ERROR: OPENAI_API_KEY is not set');
      return res.status(500).json({ 
        error: 'OPENAI_ERROR', 
        details: 'API Key is not configured. Please set OPENAI_API_KEY in Vercel environment variables.' 
      });
    }
    
    // Update client with API key
    if (client.apiKey !== apiKey) {
      client.apiKey = apiKey;
    }

    const { text, language } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`SUMMARIZE: Processing text, length: ${text.length} characters, language: ${language || 'auto-detect'}`);

    // Summarize using OpenAI GPT with detected language
    const summary = await summarizeWithGPT(text, language);

    console.log('SUMMARIZE: Success');

    return res.status(200).json(summary);

  } catch (err) {
    console.error('SUMMARIZE_ERROR:', {
      message: err?.message,
      status: err?.status,
      response: err?.response?.data,
      error: err
    });

    // Return detailed error information
    const errorDetails = err?.response?.data || err?.message || 'Unknown error';
    const statusCode = err?.status || err?.response?.status || 500;

    return res.status(statusCode).json({ 
      error: 'OPENAI_ERROR', 
      details: errorDetails,
      message: err?.message || 'Summarization failed'
    });
  }
}

async function summarizeWithGPT(text, detectedLanguage = null) {
  // Detect language (Persian or English) - use detected language if provided
  let isPersian = false;
  let language = 'English';
  
  if (detectedLanguage) {
    // Use detected language from Whisper
    isPersian = detectedLanguage === 'fa' || detectedLanguage === 'per' || detectedLanguage === 'persian';
    language = isPersian ? 'Persian' : detectedLanguage;
  } else {
    // Fallback to text-based detection
    isPersian = /[\u0600-\u06FF]/.test(text);
    language = isPersian ? 'Persian' : 'English';
  }

  // Calculate text length and determine summary length
  const wordCount = text.split(/\s+/).length;
  const charCount = text.length;
  
  // Determine summary ratio based on text length
  // Short texts (< 200 words): 30-40% summary
  // Medium texts (200-1000 words): 20-30% summary
  // Long texts (1000-5000 words): 10-20% summary
  // Very long texts (> 5000 words): 5-10% summary
  let summaryRatio = 0.3; // Default 30%
  let keyPointsCount = 5; // Default 5 points
  
  if (wordCount < 200) {
    summaryRatio = 0.35; // 35% for short texts
    keyPointsCount = 3; // 3-4 points for short texts
  } else if (wordCount < 1000) {
    summaryRatio = 0.25; // 25% for medium texts
    keyPointsCount = 5; // 5-6 points
  } else if (wordCount < 5000) {
    summaryRatio = 0.15; // 15% for long texts
    keyPointsCount = 7; // 7-8 points
  } else {
    summaryRatio = 0.08; // 8% for very long texts
    keyPointsCount = 10; // 10-12 points
  }
  
  // Calculate target summary length
  const targetSummaryWords = Math.max(Math.floor(wordCount * summaryRatio), 20); // Minimum 20 words
  const targetSummaryChars = Math.max(Math.floor(charCount * summaryRatio), 100); // Minimum 100 chars
  
  console.log(`SUMMARIZE: Text stats - Words: ${wordCount}, Chars: ${charCount}, Target summary: ~${targetSummaryWords} words, Key points: ${keyPointsCount}`);

  const systemPrompt = isPersian 
    ? `شما یک دستیار خلاصه‌ساز هوشمند هستید. متن را با نسبت مناسب خلاصه کنید و ${keyPointsCount} نکته کلیدی استخراج کنید. خلاصه باید حدود ${targetSummaryWords} کلمه باشد.`
    : `You are an intelligent summarization assistant. Summarize the text with appropriate ratio and extract ${keyPointsCount} key points. The summary should be approximately ${targetSummaryWords} words.`;

  const userPrompt = isPersian
    ? `متن زیر را خلاصه کنید و ${keyPointsCount} نکته کلیدی استخراج کنید. همچنین یک خلاصه یک‌پاراگرافی ارائه دهید که حدود ${targetSummaryWords} کلمه باشد.

متن (${wordCount} کلمه):
${text}

لطفاً پاسخ را به این فرمت JSON برگردانید:
{
  "keyPoints": ["نکته 1", "نکته 2", ...],
  "summary": "خلاصه یک‌پاراگرافی..."
}`
    : `Summarize the following text and extract ${keyPointsCount} key points. Also provide a one-paragraph summary that is approximately ${targetSummaryWords} words.

Text (${wordCount} words):
${text}

Please return the response in this JSON format:
{
  "keyPoints": ["Point 1", "Point 2", ...],
  "summary": "One paragraph summary..."
}`;

  // Adjust max_tokens based on text length
  const maxTokens = Math.min(Math.max(targetSummaryWords * 2, 500), 4000);

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini', // Using cheaper model for MVP
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: maxTokens
  });

  const content = completion.choices[0].message.content;

  // Try to parse JSON from response
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                     content.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, content];
    
    const jsonText = jsonMatch[1] || content;
    const parsed = JSON.parse(jsonText.trim());
    
    return {
      keyPoints: parsed.keyPoints || [],
      summary: parsed.summary || content
    };
  } catch (parseError) {
    // If JSON parsing fails, return the raw content
    console.warn('SUMMARIZE: Failed to parse JSON, returning raw content');
    return {
      keyPoints: [],
      summary: content
    };
  }
}
