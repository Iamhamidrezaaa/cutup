// API endpoint for downloading YouTube video audio
// Uses yt-dlp to extract audio from YouTube videos

import { handleCORS, setCORSHeaders } from './cors.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import fetchModule from 'node-fetch';

const execAsync = promisify(exec);

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { videoId, url } = req.body;

    if (!videoId && !url) {
      return res.status(400).json({ error: 'videoId or url is required' });
    }

    // Extract video ID from URL if provided
    let finalVideoId = videoId;
    if (url && !videoId) {
      const patterns = [
        /[?&]v=([^&]+)/,
        /youtu\.be\/([^?]+)/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          finalVideoId = match[1];
          break;
        }
      }
    }

    if (!finalVideoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL or video ID' });
    }

    console.log(`YOUTUBE: Extracting audio for video ID: ${finalVideoId}`);

    // Check if yt-dlp is installed
    let ytDlpPath = 'yt-dlp';
    try {
      // Try to find yt-dlp in PATH
      const { stdout } = await execAsync('which yt-dlp');
      ytDlpPath = stdout.trim() || 'yt-dlp';
      console.log(`YOUTUBE: Found yt-dlp at: ${ytDlpPath}`);
    } catch (err) {
      // Try common installation paths
      const commonPaths = [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        'yt-dlp'
      ];
      
      let found = false;
      for (const path of commonPaths) {
        try {
          await execAsync(`test -f ${path} || command -v ${path}`);
          ytDlpPath = path;
          found = true;
          console.log(`YOUTUBE: Found yt-dlp at: ${ytDlpPath}`);
          break;
        } catch (e) {
          // Continue to next path
        }
      }
      
      if (!found) {
        console.error('YOUTUBE_ERROR: yt-dlp not found in any common path');
        return res.status(500).json({ 
          error: 'YOUTUBE_ERROR',
          details: 'yt-dlp is not installed on the server. Please install it using one of these methods:\n1. apt-get install yt-dlp\n2. wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp\n3. pipx install yt-dlp',
          message: 'YouTube extraction not available'
        });
      }
    }

    // Create temporary file path
    const tempDir = tmpdir();
    const audioFilePath = join(tempDir, `youtube_${finalVideoId}_${Date.now()}.mp3`);

    try {
      // Extract audio using yt-dlp
      // Format: bestaudio/best - best audio quality available
      // Extract audio and convert to mp3
      const youtubeUrl = `https://www.youtube.com/watch?v=${finalVideoId}`;
      
      console.log(`YOUTUBE: Downloading audio from: ${youtubeUrl}`);
      
      // Use yt-dlp to extract audio
      // -x: extract audio only
      // --audio-format mp3: convert to mp3
      // -o: output file
      const command = `${ytDlpPath} -x --audio-format mp3 --audio-quality 0 -o "${audioFilePath}" "${youtubeUrl}"`;
      
      console.log(`YOUTUBE: Executing command: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      console.log(`YOUTUBE: Download complete, stdout: ${stdout.substring(0, 200)}`);
      if (stderr) {
        console.warn(`YOUTUBE: stderr: ${stderr.substring(0, 200)}`);
      }

      // Check if file exists
      if (!existsSync(audioFilePath)) {
        // Sometimes yt-dlp saves with different extension, try to find it
        const fs = await import('fs');
        const files = fs.readdirSync(tempDir);
        const matchingFile = files.find(f => f.includes(finalVideoId));
        
        if (matchingFile) {
          const actualPath = join(tempDir, matchingFile);
          console.log(`YOUTUBE: Found file with different name: ${actualPath}`);
          
          // Read file and send as base64
          const audioBuffer = fs.readFileSync(actualPath);
          
          // Clean up
          try {
            fs.unlinkSync(actualPath);
          } catch (cleanupErr) {
            console.warn('YOUTUBE: Failed to cleanup temp file:', cleanupErr);
          }
          
          const base64Audio = audioBuffer.toString('base64');
          const mimeType = 'audio/mpeg';
          
          setCORSHeaders(res);
          return res.status(200).json({
            audioUrl: `data:${mimeType};base64,${base64Audio}`,
            videoId: finalVideoId,
            format: 'mp3'
          });
        } else {
          throw new Error('Audio file not found after download');
        }
      }

      // Read the audio file
      const fs = await import('fs');
      const audioBuffer = fs.readFileSync(audioFilePath);
      
      // Check file size (limit to 25MB for Whisper API)
      const maxSize = 25 * 1024 * 1024; // 25MB
      if (audioBuffer.length > maxSize) {
        // Clean up
        try {
          fs.unlinkSync(audioFilePath);
        } catch (cleanupErr) {
          console.warn('YOUTUBE: Failed to cleanup temp file:', cleanupErr);
        }
        
        return res.status(413).json({
          error: 'FILE_TOO_LARGE',
          message: `ویدئو خیلی بزرگ است (${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB). لطفاً ویدئوی کوتاه‌تری انتخاب کنید.`,
          details: `Maximum file size is ${maxSize / 1024 / 1024}MB`
        });
      }

      // Convert to base64
      const base64Audio = audioBuffer.toString('base64');
      const mimeType = 'audio/mpeg';

      // Clean up temporary file
      try {
        fs.unlinkSync(audioFilePath);
        console.log('YOUTUBE: Temporary file cleaned up');
      } catch (cleanupErr) {
        console.warn('YOUTUBE: Failed to cleanup temp file:', cleanupErr);
      }

      console.log(`YOUTUBE: Success, audio size: ${audioBuffer.length} bytes`);

      setCORSHeaders(res);
      return res.status(200).json({
        audioUrl: `data:${mimeType};base64,${base64Audio}`,
        videoId: finalVideoId,
        format: 'mp3',
        size: audioBuffer.length
      });

    } catch (downloadError) {
      // Clean up on error
      try {
        const fs = await import('fs');
        if (existsSync(audioFilePath)) {
          fs.unlinkSync(audioFilePath);
        }
      } catch (cleanupErr) {
        console.warn('YOUTUBE: Failed to cleanup temp file on error:', cleanupErr);
      }

      console.error('YOUTUBE_ERROR: Download failed:', downloadError);
      
      setCORSHeaders(res);
      return res.status(500).json({
        error: 'YOUTUBE_ERROR',
        details: downloadError.message || 'Failed to download YouTube audio',
        message: 'YouTube audio extraction failed'
      });
    }

  } catch (error) {
    console.error('YOUTUBE_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'YOUTUBE_ERROR',
      details: error.message,
      message: 'YouTube extraction failed'
    });
  }
}

