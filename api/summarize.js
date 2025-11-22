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

    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`SUMMARIZE: Processing text, length: ${text.length} characters`);

    // Summarize using OpenAI GPT
    const summary = await summarizeWithGPT(text);

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

async function summarizeWithGPT(text) {
  // Detect language (Persian or English)
  const isPersian = /[\u0600-\u06FF]/.test(text);
  const language = isPersian ? 'Persian' : 'English';

  const systemPrompt = isPersian 
    ? `شما یک دستیار خلاصه‌ساز هوشمند هستید. متن را خلاصه کنید و 5-7 نکته کلیدی استخراج کنید.`
    : `You are an intelligent summarization assistant. Summarize the text and extract 5-7 key points.`;

  const userPrompt = isPersian
    ? `متن زیر را خلاصه کنید و 5-7 نکته کلیدی استخراج کنید. همچنین یک خلاصه یک‌پاراگرافی ارائه دهید.

متن:
${text}

لطفاً پاسخ را به این فرمت JSON برگردانید:
{
  "keyPoints": ["نکته 1", "نکته 2", ...],
  "summary": "خلاصه یک‌پاراگرافی..."
}`
    : `Summarize the following text and extract 5-7 key points. Also provide a one-paragraph summary.

Text:
${text}

Please return the response in this JSON format:
{
  "keyPoints": ["Point 1", "Point 2", ...],
  "summary": "One paragraph summary..."
}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini', // Using cheaper model for MVP
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 1000
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
