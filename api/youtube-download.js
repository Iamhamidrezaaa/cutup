// API endpoint for downloading YouTube video/audio in different qualities
// Uses yt-dlp to extract video/audio from YouTube videos
// **ENFORCEMENT POINT**: All download limits are enforced here atomically

import { handleCORS, setCORSHeaders } from './cors.js';
import { exec } from 'child_process';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { unlinkSync, existsSync, readFileSync, statSync, readdirSync, mkdirSync, rmdirSync, createReadStream } from 'fs';
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
    
    // Determine platform from URL if not provided (accepts any subdomain)
    let detectedPlatform = platform || 'youtube';
    if (url && !platform) {
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        detectedPlatform = 'youtube';
      } else if (url.includes('tiktok.com')) {
        // Accepts any TikTok subdomain (vt.tiktok.com, vm.tiktok.com, www.tiktok.com, etc.)
        detectedPlatform = 'tiktok';
      } else if (url.includes('instagram.com')) {
        // Accepts any Instagram subdomain
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
    
    // Create a job directory for this download
    const jobDir = join(tempDir, `cutup_${timestamp}`);
    mkdirSync(jobDir, { recursive: true });
    
    const outputTemplate = join(jobDir, 'out.%(ext)s');
    
    // Function to run yt-dlp once with a specific format selector
    async function runYtdlpOnce(formatSelector, useMerge = true) {
      return new Promise((resolve, reject) => {
        const baseArgs = [
          '--no-playlist',
          '--no-warnings',
          '--no-check-certificate',
          '--print', 'after_move:filepath',
          '-o', outputTemplate,
        ];

        let formatArgs = [];
        
        if (type === 'audio') {
          // Map quality to audio bitrate
          let audioQuality = '192K'; // default
          if (quality === 'best') {
            audioQuality = '0'; // Best quality
          } else if (quality && quality.includes('k')) {
            audioQuality = quality.replace('k', 'K');
          }
          
          formatArgs = [
            '-f', 'bestaudio/best',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', audioQuality
          ];
        } else {
          formatArgs = ['-f', formatSelector];
          if (useMerge && (detectedPlatform === 'tiktok' || detectedPlatform === 'instagram')) {
            formatArgs.push('--merge-output-format', 'mp4');
          } else if (useMerge && detectedPlatform === 'youtube') {
            formatArgs.push('--merge-output-format', 'mp4');
          }
        }

        const args = [...baseArgs, ...formatArgs, finalUrl];
        
        console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Trying format: ${formatSelector}`);

        const p = spawn(ytDlpPath, args, { 
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: jobDir
        });

        let stdout = '';
        let stderr = '';
        let printedPath = null;

        p.stdout.on('data', (d) => {
          const s = d.toString();
          stdout += s;

          // after_move:filepath prints the final file path as a line
          for (const line of s.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // yt-dlp prints exactly the filepath (no prefix) for after_move
            // Check if it's a valid file path
            if (trimmed.includes(join(jobDir, 'out.')) || 
                (trimmed.includes('out.') && (trimmed.endsWith('.mp4') || trimmed.endsWith('.mp3') || 
                 trimmed.endsWith('.mkv') || trimmed.endsWith('.webm') || trimmed.endsWith('.m4a'))) ||
                (trimmed.startsWith(jobDir) && (trimmed.endsWith('.mp4') || trimmed.endsWith('.mp3') || 
                 trimmed.endsWith('.mkv') || trimmed.endsWith('.webm') || trimmed.endsWith('.m4a')))) {
              // If it's a relative path, make it absolute
              if (!trimmed.startsWith('/') && !trimmed.startsWith('\\')) {
                printedPath = join(jobDir, trimmed);
              } else {
                printedPath = trimmed;
              }
              console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Captured filepath from stdout: ${printedPath}`);
            }
          }
        });

        p.stderr.on('data', (d) => {
          stderr += d.toString();
        });

        p.on('close', (code) => {
          if (code !== 0) {
            const err = new Error(`yt-dlp failed (code=${code})`);
            err.stderr = stderr;
            err.stdout = stdout;
            err.code = code;
            return reject(err);
          }

          // Fallback: if print didn't capture, look for out.* in jobDir
          if (!printedPath) {
            try {
              const files = readdirSync(jobDir).filter(f => f.startsWith('out.'));
              if (files.length > 0) {
                printedPath = join(jobDir, files[0]);
                console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Fallback - found file: ${printedPath}`);
              }
            } catch (readError) {
              console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Error reading jobDir:`, readError);
            }
          }

          if (!printedPath || !existsSync(printedPath)) {
            const err = new Error(`yt-dlp finished but output not found`);
            err.stderr = stderr;
            err.stdout = stdout;
            return reject(err);
          }

          resolve({ filepath: printedPath, stdout, stderr });
        });

        p.on('error', (err) => {
          console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: spawn error:`, err);
          reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
        });
      });
    }

    // Function to run yt-dlp with format fallback chain for Instagram/TikTok
    async function runYtdlpWithFallback() {
      if (type === 'audio') {
        // For audio, no fallback needed
        return await runYtdlpOnce('bestaudio/best', false);
      }

      if (detectedPlatform === 'tiktok' || detectedPlatform === 'instagram') {
        // Format fallback chain for Instagram/TikTok
        const formatChains = [
          // Stage A: Best quality with video+audio merge
          'bv*+ba/b',
          // Stage B: With height limit and container preference
          'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
          // Stage C: Progressive format (may be lower quality or no audio)
          'b[ext=mp4]/b',
          // Stage D: Any best format
          'b'
        ];

        // If quality is specified, add quality-specific formats at the beginning
        if (quality !== 'best') {
          const height = quality.replace('p', '');
          formatChains.unshift(
            `bv*[height<=${height}]+ba/b[height<=${height}]`,
            `bv[height<=${height}]*+ba/b[height<=${height}]`
          );
        }

        console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Trying format fallback chain:`, formatChains);

        for (let i = 0; i < formatChains.length; i++) {
          const formatSelector = formatChains[i];
          try {
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Attempt ${i + 1}/${formatChains.length}: ${formatSelector}`);
            const result = await runYtdlpOnce(formatSelector, true);
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Success with format: ${formatSelector}`);
            return result;
          } catch (e) {
            const stderr = String(e?.stderr ?? e?.message ?? '');
            const isFormatNotAvailable = stderr.includes('Requested format is not available') || 
                                        stderr.includes('format is not available');
            
            if (isFormatNotAvailable && i < formatChains.length - 1) {
              console.warn(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Format ${formatSelector} not available, trying next...`);
              continue; // Try next format
            }
            
            // If it's the last format or a different error, throw
            console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Format ${formatSelector} failed:`, stderr.substring(0, 200));
            if (i === formatChains.length - 1) {
              throw e; // Last format failed
            }
          }
        }
        
        throw new Error('No available formats found for this URL');
      } else {
        // For YouTube, use single format selector
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
        return await runYtdlpOnce(formatSelector, true);
      }
    }
    
    try {
      const { filepath, stdout, stderr } = await runYtdlpWithFallback();
      
      const outputFile = filepath;
      
      console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: File downloaded successfully: ${outputFile}`);
      
      if (stdout) {
        console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: stdout (first 500 chars):`, stdout.substring(0, 500));
      }
      if (stderr) {
        console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: stderr:`, stderr.substring(0, 1000));
      }

      // Get file size and determine content type from extension
      const fileStats = statSync(outputFile);
      const fileSize = fileStats.size;
      const fileExt = outputFile.split('.').pop().toLowerCase();

      console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: File downloaded, size: ${fileSize} bytes, extension: ${fileExt}`);

      // Determine content type based on actual file extension
      let contentType;
      if (type === 'audio') {
        contentType = fileExt === 'mp3' ? 'audio/mpeg' : 
                     fileExt === 'm4a' ? 'audio/mp4' : 
                     fileExt === 'opus' ? 'audio/opus' :
                     'audio/mpeg';
      } else {
        contentType = fileExt === 'mp4' ? 'video/mp4' :
                     fileExt === 'webm' ? 'video/webm' :
                     fileExt === 'mkv' ? 'video/x-matroska' :
                     'video/mp4';
      }
      
      const extension = fileExt;
      const filenamePrefix = detectedPlatform === 'youtube' ? `youtube_${finalVideoId || 'video'}` :
                            detectedPlatform === 'tiktok' ? `tiktok_${timestamp}` :
                            `instagram_${timestamp}`;
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}_${quality}.${extension}"`);
      res.setHeader('Content-Length', fileSize);
      
      // Helper function to safely clean up job directory
      function safeCleanup() {
        try {
          if (existsSync(outputFile)) {
            unlinkSync(outputFile);
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Cleaned up file: ${outputFile}`);
          }
          // Clean up job directory
          try {
            const files = readdirSync(jobDir);
            for (const file of files) {
              const filePath = join(jobDir, file);
              if (existsSync(filePath)) {
                unlinkSync(filePath);
              }
            }
            // Try to remove the directory
            try {
              rmdirSync(jobDir);
              console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Cleaned up jobDir: ${jobDir}`);
            } catch (e) {
              // Ignore - directory may not be empty
            }
          } catch (cleanupDirError) {
            console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Error cleaning up jobDir:`, cleanupDirError);
          }
        } catch (cleanupError) {
          console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Error cleaning up file:`, cleanupError);
        }
      }
      
      // Clean up only after response is fully sent
      res.on('finish', safeCleanup);
      res.on('close', safeCleanup);
      
      // Stream file instead of reading into memory
      const fileStream = createReadStream(outputFile);
      
      fileStream.on('error', (streamError) => {
        console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Stream error:`, streamError);
        safeCleanup();
        if (!res.headersSent) {
          setCORSHeaders(res);
          return res.status(500).json({
            error: 'STREAM_ERROR',
            message: streamError.message || 'Error streaming file'
          });
        } else {
          res.destroy(streamError);
        }
      });
      
      fileStream.pipe(res);

    } catch (downloadError) {
      console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Download error:`, downloadError);
      console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Error stack:`, downloadError.stack);
      console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: URL was:`, finalUrl);
      console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Job directory:`, jobDir);
      
      // Clean up on error - try to clean up job directory
      if (jobDir) {
        try {
          const files = readdirSync(jobDir);
          for (const file of files) {
            const filePath = join(jobDir, file);
            if (existsSync(filePath)) {
              unlinkSync(filePath);
              console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Cleaned up partial file: ${filePath}`);
            }
          }
          // Try to remove the directory
          try {
            rmdirSync(jobDir);
          } catch (e) {
            // Ignore - directory may not be empty
          }
        } catch (cleanupError) {
          console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Error cleaning up on error:`, cleanupError);
        }
      }
      
      // Re-throw with stderr/stdout attached for better error reporting
      const errorMessage = downloadError.message || downloadError.toString();
      const enhancedError = new Error(`Failed to download ${type} from ${detectedPlatform}: ${errorMessage}`);
      enhancedError.stderr = downloadError.stderr || '';
      enhancedError.stdout = downloadError.stdout || '';
      enhancedError.code = downloadError.code;
      throw enhancedError;
    }

  } catch (error) {
    console.error('DOWNLOAD_ERROR:', error);
    console.error('DOWNLOAD_ERROR stack:', error.stack);
    if (error.stderr) {
      console.error('DOWNLOAD_ERROR stderr:', error.stderr);
    }
    if (error.stdout) {
      console.error('DOWNLOAD_ERROR stdout:', error.stdout);
    }
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
    
    // Return detailed error for debugging (include stderr/stdout)
    return res.status(500).json({
      error: 'DOWNLOAD_ERROR',
      message: error.message || `Failed to download from ${platformName}`,
      stderr: error.stderr || null,
      stdout: error.stdout || null,
      code: error.code || null,
      // Include stack only in development (you can remove this in production)
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}
