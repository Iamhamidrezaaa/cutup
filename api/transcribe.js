// API endpoint for transcribing audio using Whisper
// Deploy this to Vercel as a serverless function
// VERSION 4.1 - Using node-fetch directly to avoid ECONNRESET - NO client variable

import { handleCORS, setCORSHeaders } from './cors.js';
import FormDataLib from 'form-data';
import fetchModule from 'node-fetch';
import OpenAI from 'openai';
import Busboy from 'busboy';
import { transcribeLargeFile } from './chunk-processor.js';

export default async function handler(req, res) {
  // Log immediately when function is called
  console.log("=== TRANSCRIBE FUNCTION CALLED V4.2 ===");
  console.log("TRANSCRIBE V4.2: NO OpenAI SDK - NO client variable - Using node-fetch");
  console.log("TRANSCRIBE: Timestamp:", new Date().toISOString());
  console.log("TRANSCRIBE: Request method:", req.method);
  console.log("TRANSCRIBE: Request URL:", req.url);
  
  // Initialize fetch from node-fetch module
  let fetch;
  try {
    // In node-fetch v3, the default export is the fetch function
    fetch = fetchModule.default || fetchModule;
    console.log("TRANSCRIBE: Fetch initialized, type:", typeof fetch);
    
    if (typeof fetch !== 'function') {
      throw new Error(`fetch is not a function, got: ${typeof fetch}`);
    }
  } catch (err) {
    console.error("TRANSCRIBE_ERROR: Failed to initialize fetch:", err);
    setCORSHeaders(res);
    return res.status(500).json({ 
      error: 'INIT_ERROR', 
      details: `Failed to initialize fetch: ${err.message}`,
      errorType: 'ReferenceError',
      message: 'Transcription failed [ReferenceError]'
    });
  }
  
  // Handle CORS - باید اولین کاری باشد
  const corsHandled = handleCORS(req, res);
  if (corsHandled) {
    console.log("TRANSCRIBE: OPTIONS request handled, returning");
    return; // OPTIONS request handled
  }

  // Test logs for API Key - show more characters to identify the key
  const envKey = process.env.OPENAI_API_KEY || '';
  console.log("HAS_KEY", !!envKey);
  console.log("KEY_PREFIX", envKey.slice(0, 20));
  console.log("KEY_SUFFIX", envKey.length > 10 ? '...' + envKey.slice(-10) : '');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check API Key - try multiple ways to access it
    const apiKey = process.env.OPENAI_API_KEY || 
                   (typeof process !== 'undefined' && process.env && process.env.OPENAI_API_KEY) ||
                   '';
    
    // Log more of the API key prefix to help identify which key is being used
    const keyPrefix = apiKey ? apiKey.substring(0, 20) + '...' : 'MISSING';
    const keySuffix = apiKey && apiKey.length > 10 ? '...' + apiKey.substring(apiKey.length - 10) : '';
    
    console.log('TRANSCRIBE: Environment check:', {
      hasProcess: typeof process !== 'undefined',
      hasEnv: typeof process !== 'undefined' && !!process.env,
      apiKeyPresent: !!apiKey,
      apiKeyLength: apiKey ? apiKey.length : 0,
      apiKeyPrefix: keyPrefix,
      apiKeySuffix: keySuffix,
      allEnvKeys: typeof process !== 'undefined' && process.env ? Object.keys(process.env).filter(k => k.includes('OPENAI')) : []
    });
    
    if (!apiKey || apiKey.length < 10) {
      console.error('TRANSCRIBE_ERROR: OPENAI_API_KEY is not set or invalid');
      return res.status(500).json({ 
        error: 'OPENAI_ERROR', 
        details: 'API Key is not configured. Please set OPENAI_API_KEY in Vercel environment variables and redeploy.',
        debug: {
          hasProcess: typeof process !== 'undefined',
          hasEnv: typeof process !== 'undefined' && !!process.env
        }
      });
    }

    // Check if request is multipart/form-data (file upload) or JSON
    const contentType = req.headers['content-type'] || '';
    let audioBuffer = null;
    let mimeType = 'audio/mpeg';
    
    if (contentType.includes('multipart/form-data')) {
      // Handle direct file upload (multipart/form-data) using busboy
      console.log('TRANSCRIBE: Receiving file as multipart/form-data');
      
      const busboy = Busboy({ headers: req.headers });
      const chunks = [];
      let fileReceived = false;
      
      await new Promise((resolve, reject) => {
        busboy.on('file', (name, file, info) => {
          if (name === 'file') {
            fileReceived = true;
            const { filename, encoding, mimeType: fileMimeType } = info;
            console.log(`TRANSCRIBE: Receiving file: ${filename}, type: ${fileMimeType}`);
            mimeType = fileMimeType || 'audio/mpeg';
            
            file.on('data', (data) => {
              chunks.push(data);
            });
            
            file.on('end', () => {
              console.log('TRANSCRIBE: File upload complete');
            });
          } else {
            // Ignore other fields
            file.resume();
          }
        });
        
        busboy.on('finish', () => {
          if (fileReceived && chunks.length > 0) {
            audioBuffer = Buffer.concat(chunks);
            console.log(`TRANSCRIBE: Received file via multipart, size: ${audioBuffer.length} bytes, type: ${mimeType}`);
            resolve();
          } else {
            reject(new Error('No file received in multipart request'));
          }
        });
        
        busboy.on('error', (err) => {
          console.error('TRANSCRIBE: Busboy error:', err);
          reject(err);
        });
        
        req.pipe(busboy);
      });
      
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ error: 'No audio file provided in multipart request' });
      }
      
    } else {
      // Handle JSON request (audioUrl or videoId)
      const { audioUrl, videoId, languageHint } = req.body;

      if (!audioUrl && !videoId) {
        return res.status(400).json({ error: 'audioUrl, videoId, or file is required' });
      }
      
      if (videoId) {
        // TODO: Implement YouTube audio extraction
        throw new Error('YouTube extraction not implemented yet');
      } else if (audioUrl) {
        // Handle data URL or regular URL
        if (audioUrl.startsWith('data:')) {
          // Extract base64 data from data URL
          const base64Match = audioUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            mimeType = base64Match[1];
            const base64Data = base64Match[2];
            audioBuffer = Buffer.from(base64Data, 'base64');
          } else {
            throw new Error('Invalid data URL format');
          }
        } else {
          // Download audio from URL
          const audioResponse = await fetch(audioUrl);
          if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
          }
          // Use arrayBuffer() for node-fetch v3 compatibility
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuffer);
        }
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    console.log(`TRANSCRIBE: Processing audio file, size: ${audioBuffer.length} bytes, type: ${mimeType}`);
    console.log('=== TRANSCRIBE V4.0: NO OpenAI SDK - Using node-fetch directly ===');

    // Determine file extension from mime type
    let extension = 'mp3';
    if (mimeType.includes('wav')) extension = 'wav';
    else if (mimeType.includes('m4a')) extension = 'm4a';
    else if (mimeType.includes('ogg')) extension = 'ogg';
    else if (mimeType.includes('webm')) extension = 'webm';

    // Transcribe using OpenAI Whisper API with retry logic
    // VERSION 4.0 - Using node-fetch directly (NO OpenAI SDK) to avoid ECONNRESET
    console.log('=== TRANSCRIBE V4.0: Using node-fetch (NO SDK) ===');
    console.log('TRANSCRIBE: File size:', audioBuffer.length, 'bytes, type:', mimeType);
    
    // If file is larger than 25MB, use chunk processor
    let transcript;
    if (audioBuffer.length > 25 * 1024 * 1024) {
      console.log(`TRANSCRIBE: File is ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB, using chunk processor`);
      try {
        const chunkResult = await transcribeLargeFile(audioBuffer, mimeType, apiKey, extension);
        transcript = {
          text: chunkResult.text,
          segments: chunkResult.segments,
          language: chunkResult.language
        };
        console.log('TRANSCRIBE: Chunk processing completed, text length:', transcript.text?.length || 0);
      } catch (chunkError) {
        console.error('TRANSCRIBE: Chunk processing error:', chunkError);
        setCORSHeaders(res);
        return res.status(500).json({
          error: 'TRANSCRIBE_ERROR',
          details: chunkError.message || 'Failed to transcribe large file',
          message: 'Transcription failed'
        });
      }
    } else {
      // Process normally for files <= 25MB
      const maxRetries = 5;
      let lastError;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`TRANSCRIBE V4.0: Attempt ${attempt}/${maxRetries} starting...`);
          
          // Create FormData using form-data library
          const formData = new FormDataLib();
          formData.append('file', audioBuffer, {
            filename: `audio.${extension}`,
            contentType: mimeType,
            knownLength: audioBuffer.length
          });
          formData.append('model', 'whisper-1');
          // Don't specify language - let Whisper auto-detect
          // formData.append('language', 'fa');
          formData.append('response_format', 'verbose_json'); // Get segments with timestamps
          
          // Don't add prompt yet - we'll add it only if Persian is detected
          
          // Get form data headers
          const formHeaders = formData.getHeaders();
          
          console.log(`TRANSCRIBE V4.0: Sending request to OpenAI API (attempt ${attempt})...`);
          
          // Use node-fetch with timeout
          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              ...formHeaders
            },
            body: formData,
            timeout: 300000 // 5 minutes timeout for larger files
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { message: errorText };
            }
            
            const errorMessage = errorData.error?.message || errorText || `OpenAI API error: ${response.status} ${response.statusText}`;
            
            // Log detailed error information
            console.log(`TRANSCRIBE V4.0: OpenAI API Error (attempt ${attempt}):`, {
              status: response.status,
              statusText: response.statusText,
              errorType: errorData.error?.type,
              errorCode: errorData.error?.code,
              errorMessage: errorMessage,
              fullError: errorData
            });
            
            // Check for quota errors
            if (errorMessage.includes('quota') || errorMessage.includes('billing') || response.status === 429) {
              const quotaError = new Error(errorMessage);
              quotaError.name = 'QuotaError';
              quotaError.status = response.status;
              quotaError.errorType = errorData.error?.type;
              quotaError.errorCode = errorData.error?.code;
              throw quotaError;
            }
            
            // Check for authentication errors
            if (response.status === 401 || errorMessage.includes('Invalid API key') || errorMessage.includes('Incorrect API key')) {
              const authError = new Error(errorMessage);
              authError.name = 'AuthError';
              authError.status = 401;
              throw authError;
            }
            
            throw new Error(errorMessage);
          }
          
          transcript = await response.json();
          console.log('TRANSCRIBE V4.0: Success! Text length:', transcript.text?.length || 0);
          console.log('TRANSCRIBE V4.0: Segments count:', transcript.segments?.length || 0);
          console.log('TRANSCRIBE V4.0: Detected language:', transcript.language);
          
          // If language is Persian, retry with prompt for better accuracy
          const detectedLanguage = transcript.language || 'unknown';
          const textContainsPersian = /[\u0600-\u06FF]/.test(transcript.text || '');
          const textContainsEnglish = /[a-zA-Z]/.test(transcript.text || '');
          
          // Count characters to determine dominant language
          const persianCharCount = (transcript.text || '').match(/[\u0600-\u06FF]/g)?.length || 0;
          const englishCharCount = (transcript.text || '').match(/[a-zA-Z]/g)?.length || 0;
          const totalChars = (transcript.text || '').length;
          
          console.log('TRANSCRIBE V4.0: Text analysis - Persian chars:', persianCharCount, 'English chars:', englishCharCount, 'Total:', totalChars);
          
          // Determine if text is actually Persian:
          // 1. Language is detected as Persian (fa, per, persian)
          // 2. AND text contains Persian characters
          // 3. AND Persian characters are more than 30% of the text (to avoid false positives)
          // 4. AND English characters are less than 50% of the text
          const persianRatio = totalChars > 0 ? persianCharCount / totalChars : 0;
          const englishRatio = totalChars > 0 ? englishCharCount / totalChars : 0;
          
          // If language hint is English, be very strict - don't retry with Persian prompt
          const hasEnglishHint = languageHint && (languageHint === 'en' || languageHint === 'english' || languageHint.startsWith('en'));
          
          const isActuallyPersian = !hasEnglishHint  // Don't retry if hint says English
                                    && (detectedLanguage === 'fa' || detectedLanguage === 'per' || detectedLanguage === 'persian') 
                                    && textContainsPersian 
                                    && persianRatio > 0.3  // At least 30% Persian characters
                                    && englishRatio < 0.5  // Less than 50% English characters
                                    && !(englishRatio > 0.6 && persianRatio < 0.2);  // If English is >60% and Persian <20%, definitely not Persian
          
          console.log('TRANSCRIBE V4.0: Language ratios - Persian:', persianRatio.toFixed(2), 'English:', englishRatio.toFixed(2), 'Has English hint:', hasEnglishHint, 'Is Persian:', isActuallyPersian);
          
          // If language is detected as English or other non-Persian, use it as-is
          // Don't retry with Persian prompt
          if (isActuallyPersian) {
            console.log('TRANSCRIBE V4.0: Confirmed Persian, retrying with prompt for better accuracy...');
            try {
              const formDataWithPrompt = new FormDataLib();
              formDataWithPrompt.append('file', audioBuffer, {
                filename: `audio.${extension}`,
                contentType: mimeType,
                knownLength: audioBuffer.length
              });
              formDataWithPrompt.append('model', 'whisper-1');
              formDataWithPrompt.append('language', 'fa');
              formDataWithPrompt.append('response_format', 'verbose_json');
              
              // Add comprehensive prompt for Persian poetry, songs, and common words
              const prompt = 'یار عزیز قامت بلندم بی چه نتای تا عقدت ببندم پات از حنیرن صد تا گلیش هه قلبم تو سینه ت صد منزلیش هه بی تو مه حتی وا خوم غریبم تنهایی و غم اتکه نصیبم عشق مه و تو اینی تمونی وقتی خوشن که پهلوم بمونی کس نی بپرسن وازت چه بودن یارن کجاین دشمن حسودن از شر جنتک از ترس شیطون اسپند و گشنه ی بی بی ندودن سلام، خوبی، مونا، زاهدی، کاتاب، کات آپ، cutup، پیام، تست، فارسی، زبان، شعر، آهنگ، موسیقی';
              formDataWithPrompt.append('prompt', prompt);
              
              const formHeadersWithPrompt = formDataWithPrompt.getHeaders();
              
              const retryResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  ...formHeadersWithPrompt
                },
                body: formDataWithPrompt,
                timeout: 300000
              });
              
              if (retryResponse.ok) {
                const retryTranscript = await retryResponse.json();
                if (/[\u0600-\u06FF]/.test(retryTranscript.text || '')) {
                  transcript = retryTranscript;
                  console.log('TRANSCRIBE V4.0: Retry with prompt successful');
                } else {
                  console.warn('TRANSCRIBE V4.0: Retry returned non-Persian text, using original');
                }
              } else {
                console.warn('TRANSCRIBE V4.0: Retry with prompt failed, using original transcript');
              }
            } catch (retryError) {
              console.warn('TRANSCRIBE V4.0: Error during retry with prompt, using original:', retryError.message);
            }
          } else {
            // If language is English or other non-Persian, use it as-is
            if (detectedLanguage === 'en' || detectedLanguage === 'english') {
              console.log('TRANSCRIBE V4.0: English detected, using transcript as-is');
            } else {
              console.log(`TRANSCRIBE V4.0: Language ${detectedLanguage} detected, using transcript as-is`);
            }
          }
          
          break; // Success, exit retry loop
        
        } catch (retryError) {
          lastError = retryError;
          const isConnectionError = 
            retryError?.code === 'ECONNRESET' || 
            retryError?.code === 'ETIMEDOUT' ||
            retryError?.cause?.code === 'ECONNRESET' ||
            retryError?.message?.includes('ECONNRESET') ||
            retryError?.message?.includes('Connection error') ||
            retryError?.message?.includes('timeout') ||
            retryError?.message?.includes('aborted') ||
            retryError?.name === 'AbortError' ||
            retryError?.name === 'FetchError' ||
            retryError?.type === 'system' ||
            (retryError?.cause && retryError.cause.code === 'ECONNRESET');
          
          console.log(`TRANSCRIBE V4.0: Attempt ${attempt} failed:`, {
            error: retryError?.message,
            code: retryError?.code,
            name: retryError?.name,
            type: retryError?.type,
            causeCode: retryError?.cause?.code,
            isConnectionError
          });
          
          if (isConnectionError && attempt < maxRetries) {
            const waitTime = Math.min(attempt * 3000, 10000); // 3s, 6s, 9s, 10s, 10s
            console.log(`TRANSCRIBE V4.0: Connection error detected, retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue; // Retry
          } else {
            console.log(`TRANSCRIBE V4.0: Not retrying - isConnectionError: ${isConnectionError}, attempt: ${attempt}/${maxRetries}`);
            throw retryError;
          }
        }
      }
      
      if (!transcript) {
        console.error('TRANSCRIBE V4.0: Failed after all retries');
        throw lastError || new Error('Failed to transcribe after all retries');
      }
    }

    console.log('TRANSCRIBE: Success, text length:', transcript.text?.length || 0);
    console.log('TRANSCRIBE V4.0: Segments count:', transcript.segments?.length || 0);

    // Correct transcription using GPT for better accuracy (especially for Persian names and words)
    let correctedText = transcript.text;
    let correctedSegments = transcript.segments || [];
    
    try {
      console.log('TRANSCRIBE: Starting GPT correction for better accuracy...');
      const corrected = await correctTranscriptionWithGPT(transcript.text, apiKey);
      correctedText = corrected.text;
      
      // Update segment texts with corrected text
      // Smart mapping: try to preserve timing while updating text
      if (correctedSegments.length > 0 && correctedSegments.length > 0) {
        const originalText = transcript.text;
        
        // Strategy: Split corrected text proportionally based on segment durations
        // This preserves timing while updating text content
        const totalDuration = correctedSegments[correctedSegments.length - 1].end || 0;
        const correctedWords = correctedText.split(/\s+/).filter(w => w.trim().length > 0);
        const originalWords = originalText.split(/\s+/).filter(w => w.trim().length > 0);
        
        // If word count is similar, map word by word
        if (Math.abs(correctedWords.length - originalWords.length) / Math.max(originalWords.length, 1) < 0.5) {
          let wordIndex = 0;
          correctedSegments = correctedSegments.map((segment, segIndex) => {
            const segmentWords = segment.text.trim().split(/\s+/).filter(w => w.trim().length > 0);
            const segmentWordCount = segmentWords.length;
            
            // Calculate how many words from corrected text should go in this segment
            const wordsForSegment = correctedWords.slice(wordIndex, wordIndex + segmentWordCount);
            wordIndex += segmentWordCount;
            
            // If we have words, use them; otherwise keep original
            const newText = wordsForSegment.length > 0 
              ? wordsForSegment.join(' ').trim()
              : segment.text.trim();
            
            return {
              ...segment,
              text: newText || segment.text
            };
          });
        } else {
          // If word count changed significantly, distribute corrected text proportionally by duration
          let charIndex = 0;
          correctedSegments = correctedSegments.map((segment, segIndex) => {
            const segmentDuration = segment.end - segment.start;
            const segmentRatio = totalDuration > 0 ? segmentDuration / totalDuration : 1 / correctedSegments.length;
            const charsForSegment = Math.ceil(correctedText.length * segmentRatio);
            
            const segmentText = correctedText.substring(charIndex, charIndex + charsForSegment).trim();
            charIndex += charsForSegment;
            
            return {
              ...segment,
              text: segmentText || segment.text
            };
          });
        }
      }
      
      console.log('TRANSCRIBE: GPT correction completed');
    } catch (correctionError) {
      console.warn('TRANSCRIBE: GPT correction failed, using original transcription:', correctionError.message);
      // Continue with original transcription if correction fails
    }

    // Ensure segments are valid and properly formatted
    const validSegments = (correctedSegments || []).filter(s => 
      s && 
      typeof s.start === 'number' && 
      typeof s.end === 'number' && 
      s.start >= 0 && 
      s.end > s.start &&
      s.text && 
      s.text.trim().length > 0
    );
    
    // Log segment information for debugging
    console.log('TRANSCRIBE: Final segments count:', validSegments.length);
    if (validSegments.length > 0) {
      console.log('TRANSCRIBE: First segment:', {
        start: validSegments[0].start,
        end: validSegments[0].end,
        text: validSegments[0].text.substring(0, 50)
      });
      console.log('TRANSCRIBE: Last segment:', {
        start: validSegments[validSegments.length - 1].start,
        end: validSegments[validSegments.length - 1].end,
        text: validSegments[validSegments.length - 1].text.substring(0, 50)
      });
    }

    // Ensure CORS headers are set on success
    setCORSHeaders(res);
    
    return res.status(200).json({
      text: correctedText,
      language: transcript.language || 'unknown',
      segments: validSegments // Include valid segments with timestamps for SRT
    });
  } catch (err) {
    console.error('TRANSCRIBE_ERROR:', {
      message: err?.message,
      status: err?.status,
      response: err?.response?.data,
      error: err,
      stack: err?.stack,
      name: err?.name,
      code: err?.code,
      cause: err?.cause
    });

    // Ensure CORS headers are set even on error
    setCORSHeaders(res);

    // Check error type
    const isConnectionError = err?.code === 'ECONNRESET' || 
                              err?.cause?.code === 'ECONNRESET' ||
                              err?.message?.includes('ECONNRESET') ||
                              err?.message?.includes('Connection error');
    
    const isQuotaError = err?.name === 'QuotaError' || 
                         err?.message?.includes('quota') || 
                         err?.message?.includes('billing') ||
                         err?.status === 429;
    
    const isAuthError = err?.name === 'AuthError' || 
                        err?.status === 401 ||
                        err?.message?.includes('Invalid API key') ||
                        err?.message?.includes('Incorrect API key');
    
    // Return detailed error information
    const errorDetails = err?.response?.data || err?.message || 'Unknown error';
    const statusCode = err?.status || err?.response?.status || 500;
    
    // User-friendly error message
    let userMessage = 'Transcription failed';
    let errorType = 'OPENAI_ERROR';
    
    if (isQuotaError) {
      userMessage = 'سهمیه OpenAI شما تمام شده است. لطفاً به حساب OpenAI خود بروید و سهمیه یا روش پرداخت را بررسی کنید.';
      errorType = 'QUOTA_ERROR';
    } else if (isAuthError) {
      userMessage = 'کلید API معتبر نیست. لطفاً کلید API را در تنظیمات Vercel بررسی کنید.';
      errorType = 'AUTH_ERROR';
    } else if (isConnectionError) {
      userMessage = 'خطای اتصال به سرور OpenAI. لطفاً دوباره تلاش کنید. اگر مشکل ادامه داشت، فایل ممکن است خیلی بزرگ باشد.';
      errorType = 'CONNECTION_ERROR';
    }

    // Log full error for debugging
    console.error('TRANSCRIBE: Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err)));

    return res.status(statusCode).json({ 
      error: errorType, 
      details: errorDetails,
      message: userMessage,
      errorType: err?.name || 'Unknown',
      errorCode: err?.code || err?.cause?.code || 'N/A',
      retryable: isConnectionError && !isQuotaError && !isAuthError
    });
  }
}

// Correct transcription using GPT for better accuracy
async function correctTranscriptionWithGPT(text, apiKey) {
  const client = new OpenAI({
    apiKey: apiKey
  });

  const systemPrompt = `شما یک متخصص تصحیح متن فارسی هستید که در تصحیح شعر، آهنگ و متن فارسی تخصص دارید. 
متن تبدیل شده از صوت را با دقت بالا تصحیح کنید. به خصوص:
- کلمات شعر و آهنگ فارسی
- نام‌های فارسی
- عبارات رایج فارسی
- حفظ ساختار و معنی متن

فقط اشتباهات را تصحیح کنید و ساختار کلی متن را حفظ کنید.`;

  const userPrompt = `متن زیر که از تبدیل صوت به متن (احتمالاً شعر یا آهنگ فارسی) به دست آمده را با دقت بالا تصحیح کنید.

متن اصلی:
${text}

لطفاً:
1. تمام کلمات اشتباه را درست کنید
2. ساختار شعر/آهنگ را حفظ کنید
3. معنی و مفهوم را حفظ کنید
4. فقط متن تصحیح شده را برگردانید، بدون توضیح اضافی

متن تصحیح شده:`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o', // Using more powerful model for better accuracy
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0, // Zero temperature for maximum accuracy
      max_tokens: Math.min(text.length * 3, 8000) // More tokens for longer texts
    });

    const correctedText = completion.choices[0].message.content.trim();
    
    // Remove any markdown formatting if present
    const cleanText = correctedText.replace(/```[\s\S]*?```/g, '').trim();
    
    return {
      text: cleanText,
      segments: null // Will be updated in the main function
    };
  } catch (error) {
    console.error('CORRECTION_ERROR:', error);
    // If gpt-4o fails, try with gpt-4o-mini
    try {
      const fallbackCompletion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.0,
        max_tokens: Math.min(text.length * 2, 4000)
      });
      
      const correctedText = fallbackCompletion.choices[0].message.content.trim();
      const cleanText = correctedText.replace(/```[\s\S]*?```/g, '').trim();
      
      return {
        text: cleanText,
        segments: null
      };
    } catch (fallbackError) {
      console.error('FALLBACK_CORRECTION_ERROR:', fallbackError);
      throw error;
    }
  }
}
