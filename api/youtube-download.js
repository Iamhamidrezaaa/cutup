// API endpoint for downloading YouTube video/audio in different qualities
// Uses yt-dlp to extract video/audio from YouTube videos
// **ENFORCEMENT POINT**: All download limits are enforced here atomically

import { handleCORS, setCORSHeaders } from './cors.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlinkSync, existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sessions } from './auth.js';

// Import subscription functions for atomic check + record
// We'll need to access these functions - for now, we'll duplicate the logic
// In production, refactor to a shared module

const execAsync = promisify(exec);

// Helper to get userId from session - use email as userId (consistent with subscription.js)
function getUserIdFromSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || !session.user || !session.user.email) return null;
  
  // Check if session expired
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  
  // Use email as userId (consistent with subscription.js)
  return session.user.email;
}

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // **STEP 1: Verify Session** - Get sessionId from query OR header OR body
    const sessionId = req.query?.session || req.headers['x-session-id'] || req.body?.session;
    if (!sessionId) {
      setCORSHeaders(res);
      return res.status(401).json({ error: 'No session provided. Please log in first.' });
    }

    const userId = getUserIdFromSession(sessionId);
    if (!userId) {
      setCORSHeaders(res);
      return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }
    
    console.log(`[youtube-download] Session verified: userId=${userId}, sessionId=${sessionId.substring(0, 8)}...`);

    // **STEP 2: Parse request body**
    const { videoId, url, type, quality } = req.body;

    if (!videoId && !url) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'videoId or url is required' });
    }

    if (!type || !['audio', 'video'].includes(type)) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'type must be "audio" or "video"' });
    }

    // **STEP 3: Check subscription limits ATOMICALLY (before download)**
    // Import subscription functions (atomic enforcement)
    const { canUseFeature, recordDownload } = await import('./subscription.js');
    
    // Map type to feature name
    const feature = type === 'audio' ? 'downloadAudio' : 'downloadVideo';
    
    // Check if user can download (atomic check)
    const canDownload = canUseFeature(userId, feature, 0);
    if (!canDownload.allowed) {
      setCORSHeaders(res);
      return res.status(403).json({ 
        error: 'Download limit exceeded',
        message: canDownload.reason || 'حد مجاز دانلود شما تمام شده است'
      });
    }

    // **STEP 4: Record download ATOMICALLY (before actual download)**
    // This ensures usage is recorded even if download fails later
    const metadata = {
      title: `YouTube ${type}`,
      quality: quality,
      url: url,
      videoId: videoId
    };
    
    recordDownload(userId, type, metadata, sessionId);
    
    console.log(`[youtube-download] User ${userId} authorized for ${type} download, usage recorded atomically`);

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

    console.log(`YOUTUBE_DOWNLOAD: ${type} download for video ID: ${finalVideoId}, quality: ${quality}`);

    // Check if yt-dlp is installed
    let ytDlpPath = 'yt-dlp';
    try {
      const { stdout } = await execAsync('which yt-dlp');
      if (stdout.trim()) {
        ytDlpPath = stdout.trim();
      }
    } catch (err) {
      console.warn('YOUTUBE_DOWNLOAD: yt-dlp not found in PATH, trying default');
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${finalVideoId}`;
    const tempDir = tmpdir();
    const timestamp = Date.now();
    
    let outputFile;
    let downloadCommand;

    if (type === 'audio') {
      // For audio, extract audio and convert to mp3
      const baseOutputPath = join(tempDir, `youtube_${finalVideoId}_audio_${timestamp}`);
      outputFile = `${baseOutputPath}.mp3`;
      
      // Map quality to audio bitrate
      let audioQuality = '192K'; // default
      if (quality === 'best') {
        audioQuality = '0'; // Best quality
      } else if (quality && quality.includes('k')) {
        audioQuality = quality.replace('k', 'K');
      }
      
      // Download audio and convert to mp3
      downloadCommand = `${ytDlpPath} -f "bestaudio/best" -x --audio-format mp3 --audio-quality ${audioQuality} -o "${baseOutputPath}.%(ext)s" --no-playlist --no-warnings "${youtubeUrl}"`;
    } else {
      // For video, download with specified quality and merge to mp4
      const baseOutputPath = join(tempDir, `youtube_${finalVideoId}_video_${timestamp}`);
      outputFile = `${baseOutputPath}.mp4`;
      
      // Video quality formats
      const videoFormats = {
        '2160p': 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
        '1440p': 'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
        '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
        '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
        '360p': 'bestvideo[height<=360]+bestaudio/best[height<=360]',
        '240p': 'bestvideo[height<=240]+bestaudio/best[height<=240]',
        '144p': 'bestvideo[height<=144]+bestaudio/best[height<=144]'
      };
      
      const formatSelector = videoFormats[quality] || 'bestvideo+bestaudio/best';
      
      // Download video and merge to mp4
      // Use --merge-output-format mp4 for faster download (no recoding)
      // If video is not playable, we can add --recode-video mp4 but it's slower
      downloadCommand = `${ytDlpPath} -f "${formatSelector}" --merge-output-format mp4 -o "${baseOutputPath}.mp4" --no-playlist --no-warnings "${youtubeUrl}"`;
    }

    console.log(`YOUTUBE_DOWNLOAD: Executing: ${downloadCommand}`);
    console.log(`YOUTUBE_DOWNLOAD: Expected output: ${outputFile}`);
    
    try {
      const { stdout, stderr } = await execAsync(downloadCommand, {
        timeout: 600000, // 10 minutes
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      if (stderr && !stderr.toLowerCase().includes('warning')) {
        console.warn('YOUTUBE_DOWNLOAD: stderr:', stderr.substring(0, 500));
      }

      // yt-dlp uses %(ext)s placeholder, so we need to find the actual file
      // First check the expected output file
      let foundFile = null;
      
      if (existsSync(outputFile)) {
        foundFile = outputFile;
        console.log(`YOUTUBE_DOWNLOAD: Found file at expected location: ${foundFile}`);
      } else {
        // Try to find file with different extensions
        const baseName = outputFile.substring(0, outputFile.lastIndexOf('.'));
        const possibleExtensions = type === 'audio' 
          ? ['.mp3', '.m4a', '.opus', '.ogg', '.webm', '.aac']
          : ['.mp4', '.webm', '.mkv', '.flv', '.avi', '.mov'];
        
        for (const ext of possibleExtensions) {
          const testFile = baseName + ext;
          if (existsSync(testFile)) {
            foundFile = testFile;
            console.log(`YOUTUBE_DOWNLOAD: Found file with extension ${ext}: ${foundFile}`);
            break;
          }
        }
        
        // If still not found, search in tempDir for files matching the pattern
        if (!foundFile) {
          try {
            const files = readdirSync(tempDir);
            const pattern = `youtube_${finalVideoId}_${type === 'audio' ? 'audio' : 'video'}_${timestamp}`;
            console.log(`YOUTUBE_DOWNLOAD: Searching for files matching pattern: ${pattern}`);
            
            for (const file of files) {
              if (file.includes(pattern)) {
                foundFile = join(tempDir, file);
                console.log(`YOUTUBE_DOWNLOAD: Found file by pattern: ${foundFile}`);
                break;
              }
            }
          } catch (readError) {
            console.error('YOUTUBE_DOWNLOAD: Error reading temp directory:', readError);
          }
        }
      }
      
      if (!foundFile) {
        console.error('YOUTUBE_DOWNLOAD: Could not find downloaded file');
        console.error('YOUTUBE_DOWNLOAD: Expected:', outputFile);
        console.error('YOUTUBE_DOWNLOAD: stdout length:', stdout ? stdout.length : 0);
        if (stdout) {
          console.error('YOUTUBE_DOWNLOAD: stdout (last 500 chars):', stdout.substring(Math.max(0, stdout.length - 500)));
        }
        if (stderr) {
          console.error('YOUTUBE_DOWNLOAD: stderr:', stderr);
        }
        throw new Error('Downloaded file not found. Please check server logs for details.');
      }
      
      outputFile = foundFile;

      // Get file size
      const fileStats = statSync(outputFile);
      const fileSize = fileStats.size;

      console.log(`YOUTUBE_DOWNLOAD: File downloaded, size: ${fileSize} bytes`);

      // Read file and send as response
      const fileBuffer = readFileSync(outputFile);
      
      // Set appropriate headers
      const contentType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';
      const extension = type === 'audio' ? 'mp3' : 'mp4';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="youtube_${finalVideoId}_${quality}.${extension}"`);
      res.setHeader('Content-Length', fileSize);
      
      // Send file
      res.send(fileBuffer);

      // Clean up file after sending
      setTimeout(() => {
        try {
          if (existsSync(outputFile)) {
            unlinkSync(outputFile);
            console.log(`YOUTUBE_DOWNLOAD: Cleaned up file: ${outputFile}`);
          }
        } catch (cleanupError) {
          console.error('YOUTUBE_DOWNLOAD: Error cleaning up file:', cleanupError);
        }
      }, 1000);

    } catch (downloadError) {
      console.error('YOUTUBE_DOWNLOAD: Download error:', downloadError);
      console.error('YOUTUBE_DOWNLOAD: Error stack:', downloadError.stack);
      
      // Clean up on error
      if (outputFile && existsSync(outputFile)) {
        try {
          unlinkSync(outputFile);
        } catch (cleanupError) {
          console.error('YOUTUBE_DOWNLOAD: Error cleaning up on error:', cleanupError);
        }
      }
      
      // Check if error is related to ffmpeg
      if (downloadError.message && downloadError.message.includes('ffmpeg')) {
        throw new Error(`Failed to download ${type}: ffmpeg is required for video encoding. Please install ffmpeg on the server.`);
      }
      
      throw new Error(`Failed to download ${type}: ${downloadError.message}`);
    }

  } catch (error) {
    console.error('YOUTUBE_DOWNLOAD_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'YOUTUBE_DOWNLOAD_ERROR',
      message: error.message || 'Failed to download from YouTube'
    });
  }
}
