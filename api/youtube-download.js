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
    const { videoId, url, type, quality, platform } = req.body;

    if (!videoId && !url) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'videoId or url is required' });
    }

    if (!type || !['audio', 'video'].includes(type)) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'type must be "audio" or "video"' });
    }
    
    // Determine platform from URL if not provided
    let detectedPlatform = platform || 'youtube';
    if (url && !platform) {
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        detectedPlatform = 'youtube';
      } else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
        detectedPlatform = 'tiktok';
      } else if (url.includes('instagram.com')) {
        detectedPlatform = 'instagram';
      }
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
    const platformName = detectedPlatform === 'youtube' ? 'YouTube' : 
                         detectedPlatform === 'tiktok' ? 'TikTok' : 'Instagram';
    const metadata = {
      title: `${platformName} ${type}`,
      quality: quality,
      url: url,
      videoId: videoId,
      platform: detectedPlatform
    };
    
    recordDownload(userId, type, metadata, sessionId);
    
    console.log(`[youtube-download] User ${userId} authorized for ${type} download from ${detectedPlatform}, usage recorded atomically`);

    // Extract video ID from URL if provided (only for YouTube)
    let finalVideoId = videoId;
    let finalUrl = url;
    
    if (detectedPlatform === 'youtube') {
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

      if (!finalVideoId && !url) {
        setCORSHeaders(res);
        return res.status(400).json({ error: 'Invalid YouTube URL or video ID' });
      }
      
      // Construct YouTube URL if we have video ID
      if (finalVideoId && !url) {
        finalUrl = `https://www.youtube.com/watch?v=${finalVideoId}`;
      }
    } else {
      // For TikTok and Instagram, use the URL directly
      if (!url) {
        setCORSHeaders(res);
        return res.status(400).json({ error: `Invalid ${platformName} URL` });
      }
      finalUrl = url;
    }

    console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: ${type} download for URL: ${finalUrl}, quality: ${quality}`);

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
    const tempDir = tmpdir();
    const timestamp = Date.now();
    
    let outputFile;
    let downloadCommand;

    if (type === 'audio') {
      // For audio, extract audio and convert to mp3
      const filePrefix = detectedPlatform === 'youtube' ? `youtube_${finalVideoId || 'video'}` :
                         detectedPlatform === 'tiktok' ? `tiktok_${timestamp}` :
                         `instagram_${timestamp}`;
      const baseOutputPath = join(tempDir, `${filePrefix}_audio_${timestamp}`);
      outputFile = `${baseOutputPath}.mp3`;
      
      // Map quality to audio bitrate
      let audioQuality = '192K'; // default
      if (quality === 'best') {
        audioQuality = '0'; // Best quality
      } else if (quality && quality.includes('k')) {
        audioQuality = quality.replace('k', 'K');
      }
      
      // Download audio and convert to mp3
      downloadCommand = `${ytDlpPath} -f "bestaudio/best" -x --audio-format mp3 --audio-quality ${audioQuality} -o "${baseOutputPath}.%(ext)s" --no-playlist --no-warnings "${finalUrl}"`;
    } else {
      // For video, download with specified quality and merge to mp4
      const filePrefix = detectedPlatform === 'youtube' ? `youtube_${finalVideoId || 'video'}` :
                         detectedPlatform === 'tiktok' ? `tiktok_${timestamp}` :
                         `instagram_${timestamp}`;
      const baseOutputPath = join(tempDir, `${filePrefix}_video_${timestamp}`);
      outputFile = `${baseOutputPath}.mp4`;
      
      // Video quality formats - different for different platforms
      let formatSelector;
      
      if (detectedPlatform === 'tiktok' || detectedPlatform === 'instagram') {
        // For TikTok and Instagram, use simpler format selection
        const simpleFormats = {
          'best': 'best',
          '1080p': 'best[height<=1080]',
          '720p': 'best[height<=720]',
          '480p': 'best[height<=480]',
          '360p': 'best[height<=360]'
        };
        formatSelector = simpleFormats[quality] || 'best';
        
        // For TikTok and Instagram, use simpler command
        // Use %(ext)s placeholder and let yt-dlp determine the extension
        // Then we'll find the actual file
        downloadCommand = `${ytDlpPath} -f "${formatSelector}" -o "${baseOutputPath}.%(ext)s" --no-playlist --no-warnings --no-check-certificate "${finalUrl}"`;
      } else {
        // For YouTube, use complex format selection with merging
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
        
        formatSelector = videoFormats[quality] || 'bestvideo+bestaudio/best';
        
        // Download video and merge to mp4
        // Use --merge-output-format mp4 for faster download (no recoding)
        downloadCommand = `${ytDlpPath} -f "${formatSelector}" --merge-output-format mp4 -o "${baseOutputPath}.mp4" --no-playlist --no-warnings "${finalUrl}"`;
      }
    }

    console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Executing: ${downloadCommand}`);
    console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Expected output: ${outputFile}`);
    
    try {
      const { stdout, stderr } = await execAsync(downloadCommand, {
        timeout: 600000, // 10 minutes
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      if (stderr && !stderr.toLowerCase().includes('warning')) {
        console.warn(`${detectedPlatform.toUpperCase()}_DOWNLOAD: stderr:`, stderr.substring(0, 500));
      }

      // yt-dlp uses %(ext)s placeholder, so we need to find the actual file
      // First check the expected output file
      let foundFile = null;
      
      if (existsSync(outputFile)) {
        foundFile = outputFile;
        console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Found file at expected location: ${foundFile}`);
      } else {
        // Try to find file with different extensions
        // For TikTok/Instagram, yt-dlp may use %(ext)s placeholder, so we need to check baseName without extension
        let baseName;
        if (detectedPlatform === 'tiktok' || detectedPlatform === 'instagram') {
          // For TikTok/Instagram, baseOutputPath might not have extension yet
          baseName = baseOutputPath;
        } else {
          baseName = outputFile.substring(0, outputFile.lastIndexOf('.'));
        }
        
        const possibleExtensions = type === 'audio' 
          ? ['.mp3', '.m4a', '.opus', '.ogg', '.webm', '.aac', '.mp4']
          : ['.mp4', '.webm', '.mkv', '.flv', '.avi', '.mov', '.m4v'];
        
        for (const ext of possibleExtensions) {
          const testFile = baseName + ext;
          if (existsSync(testFile)) {
            foundFile = testFile;
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Found file with extension ${ext}: ${foundFile}`);
            break;
          }
        }
        
        // If still not found, search in tempDir for files matching the pattern
        if (!foundFile) {
          try {
            const files = readdirSync(tempDir);
            let pattern;
            if (detectedPlatform === 'youtube') {
              pattern = `youtube_${finalVideoId}_${type === 'audio' ? 'audio' : 'video'}_${timestamp}`;
            } else if (detectedPlatform === 'tiktok') {
              pattern = `tiktok_${timestamp}_${type === 'audio' ? 'audio' : 'video'}_${timestamp}`;
            } else {
              pattern = `instagram_${timestamp}_${type === 'audio' ? 'audio' : 'video'}_${timestamp}`;
            }
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Searching for files matching pattern: ${pattern}`);
            
            for (const file of files) {
              if (file.includes(pattern) || file.startsWith(pattern.split('_')[0])) {
                foundFile = join(tempDir, file);
                console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Found file by pattern: ${foundFile}`);
                break;
              }
            }
            
            // If still not found, try to find any file with the timestamp
            if (!foundFile) {
              const timestampStr = timestamp.toString();
              for (const file of files) {
                if (file.includes(timestampStr) && (file.includes('audio') || file.includes('video') || file.endsWith('.mp4') || file.endsWith('.mp3'))) {
                  foundFile = join(tempDir, file);
                  console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Found file by timestamp: ${foundFile}`);
                  break;
                }
              }
            }
          } catch (readError) {
            console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Error reading temp directory:`, readError);
          }
        }
      }
      
      if (!foundFile) {
        console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Could not find downloaded file`);
        console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Expected:`, outputFile);
        console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Base output path:`, baseOutputPath);
        console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: stdout length:`, stdout ? stdout.length : 0);
        if (stdout) {
          console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: stdout (last 500 chars):`, stdout.substring(Math.max(0, stdout.length - 500)));
        }
        if (stderr) {
          console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: stderr:`, stderr);
        }
        throw new Error(`Downloaded file not found for ${detectedPlatform}. Please check server logs for details.`);
      }
      
      outputFile = foundFile;

      // Get file size
      const fileStats = statSync(outputFile);
      const fileSize = fileStats.size;

      console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: File downloaded, size: ${fileSize} bytes`);

      // Read file and send as response
      const fileBuffer = readFileSync(outputFile);
      
      // Set appropriate headers
      const contentType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';
      const extension = type === 'audio' ? 'mp3' : 'mp4';
      const filenamePrefix = detectedPlatform === 'youtube' ? `youtube_${finalVideoId || 'video'}` :
                            detectedPlatform === 'tiktok' ? `tiktok_${timestamp}` :
                            `instagram_${timestamp}`;
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}_${quality}.${extension}"`);
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
    console.error('DOWNLOAD_ERROR:', error);
    setCORSHeaders(res);
    
    // Determine platform for error message
    const { url, platform } = req.body || {};
    let detectedPlatform = platform || 'youtube';
    if (url && !platform) {
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        detectedPlatform = 'youtube';
      } else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
        detectedPlatform = 'tiktok';
      } else if (url.includes('instagram.com')) {
        detectedPlatform = 'instagram';
      }
    }
    
    const platformName = detectedPlatform === 'youtube' ? 'YouTube' : 
                         detectedPlatform === 'tiktok' ? 'TikTok' : 
                         detectedPlatform === 'instagram' ? 'Instagram' : 'platform';
    
    return res.status(500).json({
      error: 'DOWNLOAD_ERROR',
      message: error.message || `Failed to download from ${platformName}`
    });
  }
}
