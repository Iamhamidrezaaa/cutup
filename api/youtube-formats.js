// API endpoint for getting available YouTube video/audio formats
// Uses yt-dlp to get format list

import { handleCORS, setCORSHeaders } from './cors.js';
import { exec } from 'child_process';
import { promisify } from 'util';

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

    console.log(`YOUTUBE_FORMATS: Getting formats for video ID: ${finalVideoId}`);

    // Check if yt-dlp is installed
    let ytDlpPath = 'yt-dlp';
    try {
      const { stdout } = await execAsync('which yt-dlp');
      if (stdout.trim()) {
        ytDlpPath = stdout.trim();
      }
    } catch (err) {
      console.warn('YOUTUBE_FORMATS: yt-dlp not found in PATH, trying default');
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${finalVideoId}`;

    // Get available formats
    const formatsCommand = `${ytDlpPath} --list-formats --no-playlist "${youtubeUrl}"`;
    
    console.log(`YOUTUBE_FORMATS: Executing: ${formatsCommand}`);
    
    try {
      const { stdout, stderr } = await execAsync(formatsCommand, {
        timeout: 30000, // 30 seconds
        maxBuffer: 5 * 1024 * 1024 // 5MB buffer
      });

      if (stderr) {
        console.warn('YOUTUBE_FORMATS: stderr:', stderr.substring(0, 500));
      }

      // Parse formats from output
      const audioFormats = [];
      const videoFormats = [];

      const lines = stdout.split('\n');
      let inFormatsSection = false;

      for (const line of lines) {
        if (line.includes('ID') && line.includes('EXT')) {
          inFormatsSection = true;
          continue;
        }

        if (inFormatsSection && line.trim()) {
          // Parse format line
          // Format: ID  EXT   RESOLUTION FPS │ FILESIZE   TBR PROTO │ VCODEC  VBR ACODEC      ABR     ASR MORE INFO
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const formatId = parts[0];
            const ext = parts[1];
            const resolution = parts[2] || 'unknown';
            const hasVideo = parts.some(p => p.includes('video') || p.includes('avc1') || p.includes('vp9'));
            const hasAudio = parts.some(p => p.includes('audio') || p.includes('mp4a') || p.includes('opus'));

            if (hasAudio && !hasVideo) {
              // Audio only
              audioFormats.push({
                id: formatId,
                ext: ext,
                resolution: resolution,
                type: 'audio'
              });
            } else if (hasVideo) {
              // Video (may include audio)
              videoFormats.push({
                id: formatId,
                ext: ext,
                resolution: resolution,
                type: 'video'
              });
            }
          }
        }
      }

      // Return simplified format list
      return res.json({
        audio: audioFormats,
        video: videoFormats,
        available: {
          audio: ['best', '320k', '256k', '192k', '128k', '96k', '64k'],
          video: ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
        }
      });

    } catch (formatsError) {
      console.error('YOUTUBE_FORMATS: Error getting formats:', formatsError);
      
      // Return default formats if we can't get actual formats
      return res.json({
        audio: [],
        video: [],
        available: {
          audio: ['best', '320k', '256k', '192k', '128k', '96k', '64k'],
          video: ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
        }
      });
    }

  } catch (error) {
    console.error('YOUTUBE_FORMATS_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'YOUTUBE_FORMATS_ERROR',
      message: error.message || 'Failed to get YouTube formats'
    });
  }
}

