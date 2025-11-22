// API endpoint for uploading and transcribing audio files
// This endpoint receives audio files, transcribes them directly, and returns the result
// This avoids the 4.5MB limit by processing the file in the same endpoint

import { handleCORS, setCORSHeaders } from './cors.js';
import FormDataLib from 'form-data';
import fetchModule from 'node-fetch';
import OpenAI from 'openai';
import Busboy from 'busboy';

export default async function handler(req, res) {
  // Log immediately to verify this endpoint is being called
  console.log('=== UPLOAD ENDPOINT CALLED ===');
  console.log('UPLOAD: Method:', req.method);
  console.log('UPLOAD: Content-Type:', req.headers['content-type']);
  
  // Handle CORS - باید اولین کاری باشد
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return; // OPTIONS request handled

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check API Key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('UPLOAD_ERROR: OPENAI_API_KEY is not set');
      return res.status(500).json({ 
        error: 'OPENAI_ERROR', 
        details: 'API Key is not configured. Please set OPENAI_API_KEY in Vercel environment variables.' 
      });
    }

    // Initialize fetch
    let fetch;
    try {
      fetch = fetchModule.default || fetchModule;
      if (typeof fetch !== 'function') {
        throw new Error(`fetch is not a function, got: ${typeof fetch}`);
      }
    } catch (err) {
      console.error("UPLOAD_ERROR: Failed to initialize fetch:", err);
      setCORSHeaders(res);
      return res.status(500).json({ 
        error: 'INIT_ERROR', 
        details: `Failed to initialize fetch: ${err.message}`
      });
    }

    // Check file size limit before processing (Vercel has 4.5MB limit for request body)
    // We'll limit to 4MB to be safe
    const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
    
    // Receive file using busboy
    console.log('UPLOAD: Receiving file as multipart/form-data');
    
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE } });
    const chunks = [];
    let fileReceived = false;
    let mimeType = 'audio/mpeg';
    let filename = 'audio.mp3';
    let totalSize = 0;
    
    await new Promise((resolve, reject) => {
      busboy.on('file', (name, file, info) => {
        if (name === 'file') {
          fileReceived = true;
          const { filename: fileFilename, encoding, mimeType: fileMimeType } = info;
          console.log(`UPLOAD: Receiving file: ${fileFilename}, type: ${fileMimeType}`);
          filename = fileFilename || 'audio.mp3';
          mimeType = fileMimeType || 'audio/mpeg';
          
          file.on('data', (data) => {
            totalSize += data.length;
            if (totalSize > MAX_FILE_SIZE) {
              file.destroy();
              reject(new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`));
              return;
            }
            chunks.push(data);
          });
          
          file.on('end', () => {
            console.log('UPLOAD: File upload complete');
          });
          
          file.on('error', (err) => {
            console.error('UPLOAD: File stream error:', err);
            reject(err);
          });
        } else {
          file.resume();
        }
      });
      
      busboy.on('finish', () => {
        if (fileReceived && chunks.length > 0) {
          console.log(`UPLOAD: File received, size: ${totalSize} bytes`);
          resolve();
        } else {
          reject(new Error('No file received in multipart request'));
        }
      });
      
      busboy.on('error', (err) => {
        console.error('UPLOAD: Busboy error:', err);
        reject(err);
      });
      
      req.pipe(busboy);
    });
    
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    if (totalSize > MAX_FILE_SIZE) {
      setCORSHeaders(res);
      return res.status(413).json({ 
        error: 'FILE_TOO_LARGE',
        message: `فایل خیلی بزرگ است (${(totalSize / 1024 / 1024).toFixed(2)}MB). لطفاً فایلی کمتر از 4MB انتخاب کنید.`,
        details: `Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }
    
    const audioBuffer = Buffer.concat(chunks);
    console.log(`UPLOAD: Processing audio file, size: ${audioBuffer.length} bytes, type: ${mimeType}`);

    // Determine file extension from mime type
    let extension = 'mp3';
    if (mimeType.includes('wav')) extension = 'wav';
    else if (mimeType.includes('m4a')) extension = 'm4a';
    else if (mimeType.includes('ogg')) extension = 'ogg';
    else if (mimeType.includes('webm')) extension = 'webm';

    // Transcribe using OpenAI Whisper API
    console.log('UPLOAD: Sending to Whisper API...');
    
    const formData = new FormDataLib();
    formData.append('file', audioBuffer, {
      filename: `audio.${extension}`,
      contentType: mimeType,
      knownLength: audioBuffer.length
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'fa');
    formData.append('response_format', 'verbose_json');
    
    // Add comprehensive prompt for Persian poetry, songs, and common words
    const prompt = 'یار عزیز قامت بلندم بی چه نتای تا عقدت ببندم پات از حنیرن صد تا گلیش هه قلبم تو سینه ت صد منزلیش هه بی تو مه حتی وا خوم غریبم تنهایی و غم اتکه نصیبم عشق مه و تو اینی تمونی وقتی خوشن که پهلوم بمونی کس نی بپرسن وازت چه بودن یارن کجاین دشمن حسودن از شر جنتک از ترس شیطون اسپند و گشنه ی بی بی ندودن سلام، خوبی، مونا، زاهدی، کاتاب، کات آپ، cutup، پیام، تست، فارسی، زبان، شعر، آهنگ، موسیقی';
    formData.append('prompt', prompt);
    
    const formHeaders = formData.getHeaders();
    
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formHeaders
      },
      body: formData,
      timeout: 300000 // 5 minutes timeout
    });
    
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      
      const errorMessage = errorData.error?.message || errorText || `OpenAI API error: ${whisperResponse.status} ${whisperResponse.statusText}`;
      console.error('UPLOAD: Whisper API Error:', errorMessage);
      
      setCORSHeaders(res);
      return res.status(whisperResponse.status).json({ 
        error: 'WHISPER_ERROR', 
        details: errorMessage,
        message: 'Transcription failed'
      });
    }
    
    const transcript = await whisperResponse.json();
    
    // Log full transcript for debugging
    console.log('UPLOAD: Whisper response:', {
      hasText: !!transcript.text,
      textLength: transcript.text?.length || 0,
      hasSegments: !!transcript.segments,
      segmentsCount: transcript.segments?.length || 0,
      language: transcript.language,
      fullResponse: JSON.stringify(transcript).substring(0, 200)
    });
    
    // Validate transcript response
    if (!transcript) {
      console.error('UPLOAD: No transcript response received');
      setCORSHeaders(res);
      return res.status(500).json({ 
        error: 'INVALID_RESPONSE',
        message: 'Whisper API returned no response',
        details: 'Transcript is missing'
      });
    }
    
    if (!transcript.text || transcript.text.trim().length === 0) {
      console.error('UPLOAD: Invalid transcript response - no text:', transcript);
      setCORSHeaders(res);
      return res.status(500).json({ 
        error: 'INVALID_RESPONSE',
        message: 'Whisper API returned empty text',
        details: 'Transcript text is missing or empty',
        transcript: transcript
      });
    }
    
    console.log('UPLOAD: Whisper success, text length:', transcript.text.length);
    console.log('UPLOAD: Segments count:', transcript.segments?.length || 0);

    // Use original transcript text directly (GPT correction disabled temporarily)
    // TODO: Re-enable GPT correction with better error handling
    let correctedText = transcript.text || '';
    let correctedSegments = (transcript.segments && Array.isArray(transcript.segments)) ? transcript.segments : [];
    
    console.log('UPLOAD: Using Whisper transcription directly (GPT correction disabled)');

    // Ensure segments are valid
    const validSegments = (correctedSegments || []).filter(s => 
      s && 
      typeof s.start === 'number' && 
      typeof s.end === 'number' && 
      s.start >= 0 && 
      s.end > s.start &&
      s.text && 
      s.text.trim().length > 0
    );

    // Final validation - ensure we have text
    if (!correctedText || correctedText.trim().length === 0) {
      console.error('UPLOAD: No text after all processing. Checking original transcript...');
      console.error('UPLOAD: Original transcript.text exists:', !!transcript.text);
      console.error('UPLOAD: Original transcript.text length:', transcript.text?.length || 0);
      
      // Last resort - use original transcript text
      correctedText = transcript.text || '';
      
      if (!correctedText || correctedText.trim().length === 0) {
        console.error('UPLOAD: No text available at all. Transcript object:', JSON.stringify(transcript).substring(0, 500));
        setCORSHeaders(res);
        return res.status(500).json({ 
          error: 'NO_TEXT',
          message: 'No text was transcribed from the audio file',
          details: 'The audio file may be empty, corrupted, or contain no speech',
          transcript: transcript
        });
      }
    }
    
    console.log('UPLOAD: Final response preparation - text length:', correctedText.length, 'segments:', validSegments.length);
    console.log('UPLOAD: Text preview:', correctedText.substring(0, 100));
    
    const responseData = {
      text: correctedText,
      language: transcript.language || 'fa',
      segments: validSegments || []
    };
    
    console.log('UPLOAD: Sending response with text length:', responseData.text.length);
    console.log('UPLOAD: Response data keys:', Object.keys(responseData));
    console.log('UPLOAD: Response preview:', JSON.stringify(responseData).substring(0, 200));
    
    setCORSHeaders(res);
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('UPLOAD_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({ 
      error: 'UPLOAD_ERROR', 
      details: error.message,
      message: 'Upload and transcription failed'
    });
  }
}

