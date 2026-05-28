// API endpoint for getting available video/audio formats
// Supports YouTube, TikTok, and Instagram
// Uses yt-dlp to get format list

import { handleCORS, setCORSHeaders } from './cors.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireSessionEmail } from './processing-enforcement.js';
import { parseYouTubeVideoId, normalizeYouTubeWatchUrl, stripTrackingQueryParams } from './media-url.js';
import { resolveYtDlpPath, runYtDlpRobust } from './ytdlp-robust.js';

const execAsync = promisify(exec);

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userEmail = requireSessionEmail(req, res);
  if (!userEmail) return;

  try {
    const { videoId, url, platform } = req.body;

    if (!videoId && !url) {
      return res.status(400).json({ error: 'videoId or url is required' });
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

    console.log(`FORMATS: user=${userEmail} platform=${detectedPlatform}, URL: ${url}`);

    // For TikTok and Instagram, use URL directly and return default formats
    if (detectedPlatform === 'tiktok' || detectedPlatform === 'instagram') {
      // For TikTok and Instagram, yt-dlp may have different format structures
      // Return default formats that work with these platforms
      return res.json({
        audio: [],
        video: [],
        available: {
          audio: ['best', '320k', '256k', '192k', '128k'],
          video: ['best', '1080p', '720p', '480p', '360p']
        }
      });
    }

    const cleanedUrl = url ? stripTrackingQueryParams(url) : '';
    let finalVideoId = videoId || (cleanedUrl ? parseYouTubeVideoId(cleanedUrl) : null);
    if (cleanedUrl && /\/shorts\//i.test(cleanedUrl)) {
      console.log('[yt-shorts]', { route: 'youtube-formats', videoId: finalVideoId, normalized: normalizeYouTubeWatchUrl(cleanedUrl) });
    }

    if (!finalVideoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL or video ID' });
    }

    console.log(`YOUTUBE_FORMATS: Getting formats for video ID: ${finalVideoId}`);

    const ytDlpPath = await resolveYtDlpPath();
    try {
      const { stdout: yv } = await execAsync(`${ytDlpPath} --version`);
      console.log('[ytdlp-version-debug]', { version: String(yv || '').trim() || 'unknown', path: ytDlpPath });
    } catch {
      console.log('[ytdlp-version-debug]', { version: 'unknown', path: ytDlpPath });
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${finalVideoId}`;

    try {
      const { stdout, stderr } = await runYtDlpRobust({
        ytDlpPath,
        baseArgs: ['--list-formats', '--no-playlist'],
        url: youtubeUrl,
        requestKey: userEmail,
        mode: 'formats'
      });
      console.log('[ytdlp-stream-debug]', {
        availableFormatsCount: null,
        selectedFormat: 'list-formats',
        extractor: 'yt-dlp',
        playerClient: /\/shorts\//i.test(cleanedUrl) ? 'android' : 'normal',
        cookiesEnabled: false,
        urlNormalized: cleanedUrl !== youtubeUrl
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
    console.error('FORMATS_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'FORMATS_ERROR',
      message: error.message || 'Failed to get formats'
    });
  }
}

