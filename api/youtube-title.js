// API endpoint for extracting YouTube video title
// Uses yt-dlp to get video metadata (title) without downloading

import { handleCORS, setCORSHeaders } from './cors.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    setCORSHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { videoId, url } = req.body;

    if (!videoId && !url) {
      setCORSHeaders(res);
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
      setCORSHeaders(res);
      return res.status(400).json({ error: 'Invalid YouTube URL or video ID' });
    }

    console.log(`YOUTUBE_TITLE: Extracting title for video ID: ${finalVideoId}`);

    // Check if yt-dlp is installed
    let ytDlpPath = 'yt-dlp';
    try {
      // Try to find yt-dlp in PATH
      const { stdout } = await execAsync('which yt-dlp');
      if (stdout.trim()) {
        ytDlpPath = stdout.trim();
        console.log(`YOUTUBE_TITLE: Found yt-dlp at: ${ytDlpPath}`);
      }
    } catch (whichError) {
      // Try common paths
      const commonPaths = [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        '~/.local/bin/yt-dlp'
      ];
      
      for (const path of commonPaths) {
        try {
          await execAsync(`test -f ${path}`);
          ytDlpPath = path;
          console.log(`YOUTUBE_TITLE: Found yt-dlp at: ${ytDlpPath}`);
          break;
        } catch (testError) {
          // Continue to next path
        }
      }
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${finalVideoId}`;
    
    console.log(`YOUTUBE_TITLE: Getting metadata from: ${youtubeUrl}`);
    
    // Get video metadata (title) using yt-dlp
    let videoTitle = null;
    let videoDuration = null;
    
    try {
      const metadataCommand = `${ytDlpPath} --dump-json --no-download "${youtubeUrl}"`;
      const { stdout: metadataStdout } = await execAsync(metadataCommand, {
        timeout: 30000, // 30 seconds
        maxBuffer: 5 * 1024 * 1024 // 5MB buffer
      });
      const metadata = JSON.parse(metadataStdout);
      
      // Get video title
      if (metadata.title) {
        videoTitle = metadata.title;
        console.log(`YOUTUBE_TITLE: Video title: ${videoTitle}`);
      } else {
        console.warn('YOUTUBE_TITLE: No title found in metadata');
        console.warn('YOUTUBE_TITLE: Metadata keys:', Object.keys(metadata || {}));
      }
      
      // Get video duration
      if (metadata.duration) {
        videoDuration = metadata.duration;
        console.log(`YOUTUBE_TITLE: Video duration: ${videoDuration} seconds`);
      }
    } catch (metadataError) {
      console.error('YOUTUBE_TITLE: Error getting metadata:', metadataError.message);
      setCORSHeaders(res);
      return res.status(500).json({
        error: 'YOUTUBE_ERROR',
        details: metadataError.message || 'Failed to get video metadata',
        message: 'Failed to extract video title'
      });
    }

    setCORSHeaders(res);
    return res.status(200).json({
      videoId: finalVideoId,
      title: videoTitle || null,
      duration: videoDuration || null
    });

  } catch (error) {
    console.error('YOUTUBE_TITLE_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'YOUTUBE_ERROR',
      details: error.message,
      message: 'YouTube title extraction failed'
    });
  }
}

