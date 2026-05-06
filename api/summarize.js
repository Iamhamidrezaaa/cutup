// API endpoint for summarizing text using GPT
// Deploy this to Vercel as a serverless function

import OpenAI from 'openai';
import { handleCORS, setCORSHeaders } from './cors.js';
import {
  requireSessionEmail,
  estimateSummarizationBillMinutes,
  consumeSummarizationUsage
} from './processing-enforcement.js';

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
    const userEmail = requireSessionEmail(req, res);
    if (!userEmail) return;

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

    const { text, language, metadata } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const billMinutes = estimateSummarizationBillMinutes(text);

    console.log(`SUMMARIZE: Processing text, length: ${text.length} characters, language: ${language || 'auto-detect'}`);

    let summary = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        summary = await summarizeWithGPT(text, language);
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`SUMMARIZE: attempt ${attempt} failed:`, e?.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 800));
      }
    }
    if (!summary) throw lastErr;

    console.log('SUMMARIZE: Success');

    await consumeSummarizationUsage(userEmail, billMinutes, {
      route: 'summarize',
      textLength: text.length,
      processingSessionId: metadata?.processingSessionId || metadata?.sessionId || null,
      outputType: 'summary',
      platform: metadata?.platform || null,
      title: metadata?.title || null,
      sourceUrl: metadata?.sourceUrl || null,
      durationSeconds: metadata?.durationSeconds || null,
      filename: metadata?.filename || null,
      ...((metadata && typeof metadata === 'object') ? metadata : {})
    });

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

// Helper function to extract key points from text (fallback)
function extractKeyPointsFromText(text, count) {
  const sentences = text.split(/[.!?]\s+/).filter(s => s.trim().length > 20);
  const points = sentences.slice(0, count).map(s => s.trim());
  return points.length > 0 ? points : ['Summary generated'];
}

async function summarizeWithGPT(text, detectedLanguage = null) {
  const dl =
    detectedLanguage != null && detectedLanguage !== ''
      ? String(detectedLanguage).toLowerCase().trim()
      : '';
  let langIso = null;
  if (dl === 'per' || dl === 'persian' || dl === 'fas' || dl === 'fa') {
    langIso = 'fa';
  } else if (dl.length >= 2 && /^[a-z]{2}$/.test(dl.slice(0, 2))) {
    langIso = dl.slice(0, 2);
  } else if (dl.length === 2 && /^[a-z]{2}$/.test(dl)) {
    langIso = dl;
  }

  // Only use Persian prompts when language is actually Persian (never infer from Arabic script:
  // Arabic/Urdu/etc. share the same Unicode range and falsely triggered Persian before).
  const isPersian = langIso === 'fa';

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
  // Removed targetSummaryChars - not used
  
  console.log(`SUMMARIZE: Text stats - Words: ${wordCount}, Chars: ${charCount}, Target summary: ~${targetSummaryWords} words, Key points: ${keyPointsCount}`);

  const outputLanguageRule = langIso
    ? `OUTPUT LANGUAGE IS LOCKED TO ISO 639-1 "${langIso}". All key points and the summary MUST be in that language only. Never translate to Persian (fa) unless "${langIso}" is fa. Never translate to English unless "${langIso}" is en. Never switch languages.`
    : `Write every key point and the summary in the same language as the source text (dominant language if mixed). Do not translate: keep Persian only if the source is Persian; keep English only if the source is English; same for Arabic, Chinese, etc.`;

  const systemPrompt = isPersian
    ? `شما یک دستیار خلاصه‌ساز هوشمند هستید. متن را با نسبت مناسب خلاصه کنید و ${keyPointsCount} نکته کلیدی استخراج کنید. خلاصه باید حدود ${targetSummaryWords} کلمه باشد.`
    : `You are an intelligent summarization assistant. Summarize the text with appropriate ratio and extract ${keyPointsCount} key points. The summary should be approximately ${targetSummaryWords} words.

${outputLanguageRule}`;

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

${outputLanguageRule}

Text (${wordCount} words):
${text}

Return JSON only in this shape (use the output language rule for all string values):
{
  "keyPoints": ["...", "..."],
  "summary": "..."
}`;

  // Adjust max_tokens based on text length - reduced for faster response
  const maxTokens = Math.min(Math.max(targetSummaryWords * 1.5, 300), 2000); // Reduced from 4000 to 2000 for speed

  // Use streaming for faster response (especially for long texts)
  // For shorter texts, use regular completion for better reliability
  // Disable streaming for now - it's causing parsing issues
  const useStreaming = false; // wordCount > 1000;
  
  if (useStreaming) {
    // Use streaming for long texts - faster perceived response
    const stream = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
      stream: true
    });
    
    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
      }
    }
    
    // Parse the streamed response
    try {
      // Try to extract JSON from response
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // Fallback: create summary from text
      return {
        keyPoints: extractKeyPointsFromText(fullResponse, keyPointsCount),
        summary: fullResponse
      };
    } catch (parseError) {
      console.error('SUMMARIZE: Failed to parse streamed response, using fallback');
      return {
        keyPoints: extractKeyPointsFromText(fullResponse, keyPointsCount),
        summary: fullResponse
      };
    }
  } else {
    // Use regular completion for shorter texts
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
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // Fallback: create summary from text
      return {
        keyPoints: extractKeyPointsFromText(content, keyPointsCount),
        summary: content
      };
    } catch (parseError) {
      console.error('SUMMARIZE: Failed to parse response, using fallback');
      return {
        keyPoints: extractKeyPointsFromText(content, keyPointsCount),
        summary: content
      };
    }
  }

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
