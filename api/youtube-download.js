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
import { isBillingDbConfigured, consumeDownloadSlotAtomic, refundDownloadSlotAtomic } from './billing-repository.js';
import {
  resolveTraceId,
  sendTranscriptError,
  mapLegacyDownloadError
} from './transcript-errors.js';
import { traceLog } from './pipeline-trace.js';
import {
  detectPlatformFromUrl,
  validateMediaUrl,
  parseYouTubeVideoId,
  normalizeYouTubeWatchUrl,
  stripTrackingQueryParams,
  normalizeInstagramUrl
} from './media-url.js';
import {
  resolveYtDlpPath,
  resolveCookiesPath,
  classifyYtDlpError,
  applyYtdlpBurstDelay,
  buildInstagramAuthVariants,
  isInstagramAuthBlock
} from './ytdlp-robust.js';

const INSTAGRAM_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
import { runQueuedDownload } from './infrastructure/guards.js';
import { extractionDebug } from './infrastructure/observability.js';

// Import subscription functions for atomic check + record
// We'll need to access these functions - for now, we'll duplicate the logic
// In production, refactor to a shared module

const execAsync = promisify(exec);
const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 120000);
const YTDLP_MAX_RETRIES = Math.max(1, Number(process.env.YTDLP_MAX_RETRIES || 3));


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
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const traceId = resolveTraceId(req, requestId);
  const plog = (stage, data = {}) => console.log(`[PIPELINE][${requestId}][youtube-download][${stage}]`, data);
  traceLog(traceId, 'start', { route: 'youtube-download', requestId });
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Trace-Id', traceId);
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let slotConsumed = false;
  let downloadUserEmail = null;
  let downloadKind = null;
  let downloadMeta = null;

  async function refundDownloadSlotIfConsumed() {
    if (!slotConsumed || !downloadUserEmail || !downloadKind) return;
    try {
      await refundDownloadSlotAtomic(downloadUserEmail, downloadKind, downloadMeta || {});
      slotConsumed = false;
    } catch (refundErr) {
      console.warn('[quota-refund-failed]', refundErr?.message);
    }
  }

  try {
    if (!isBillingDbConfigured()) {
      setCORSHeaders(res);
      return res.status(503).json({
        error: 'service_unavailable',
        code: 'BILLING_UNAVAILABLE',
        message: 'Billing is not configured. Set DATABASE_URL and run database migrations.'
      });
    }

    // **STEP 1: Verify Session** - Get sessionId from query OR header OR body
    const sessionId = req.query?.session || req.headers['x-session-id'] || req.body?.session;
    if (!sessionId) {
      setCORSHeaders(res);
      return res.status(401).json({
        error: 'unauthorized',
        code: 'NO_SESSION',
        message: 'Sign in is required for downloads.'
      });
    }

    const userId = getUserIdFromSession(sessionId);
    if (!userId) {
      setCORSHeaders(res);
      return res.status(401).json({
        error: 'unauthorized',
        code: 'INVALID_SESSION',
        message: 'Your session is invalid or expired. Please sign in again.'
      });
    }
    
    console.log(`[youtube-download] Session verified: userId=${userId}, sessionId=${sessionId.substring(0, 8)}...`);

    // **STEP 2: Parse request body**
    const { videoId, url, type, quality, platform } = req.body;
    plog('REQUEST_PARSED', { hasUrl: !!url, hasVideoId: !!videoId, type, quality, platform });
    traceLog(traceId, 'parse', { type, quality, platform: platform || null, hasUrl: !!url, hasVideoId: !!videoId });

    if (!videoId && !url) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'videoId or url is required' });
    }

    if (!type || !['audio', 'video'].includes(type)) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'type must be "audio" or "video"' });
    }
    
    const originalUrl = String(url || '');
    const cleanedUrl = url ? stripTrackingQueryParams(url) : '';
    let detectedPlatform = platform || detectPlatformFromUrl(cleanedUrl) || 'youtube';
    plog('PLATFORM_DETECTED', { requestedPlatform: platform || null, detectedPlatform, incomingUrl: cleanedUrl || null });
    console.log('[platform-detected]', { traceId, detectedPlatform, url: cleanedUrl?.slice(0, 120) });

    if (cleanedUrl) {
      const validation = validateMediaUrl(cleanedUrl, detectedPlatform);
      if (!validation.ok) {
        plog('URL_VALIDATION_FAILED', { detectedPlatform, code: validation.code, reason: validation.reason, url: cleanedUrl });
        const mapped = mapLegacyDownloadError(validation.code, { message: validation.reason, platform: detectedPlatform });
        return sendTranscriptError(res, {
          statusCode: 400,
          errorCode: mapped.errorCode,
          message: mapped.message,
          retryable: false,
          traceId,
          stage: 'youtube-download'
        });
      }
      detectedPlatform = validation.platform || detectedPlatform;
    }

    const platformName = detectedPlatform === 'youtube' ? 'YouTube' : 
                         detectedPlatform === 'tiktok' ? 'TikTok' : 'Instagram';
    downloadKind = type;
    downloadMeta = {
      title: `${platformName} ${type}`,
      quality: quality,
      url: cleanedUrl || url,
      videoId: videoId,
      platform: detectedPlatform
    };
    const metadata = downloadMeta;

    // Extract video ID / canonical URL before consuming quota
    let finalVideoId = videoId;
    let finalUrl = cleanedUrl;

    if (detectedPlatform === 'youtube') {
      finalVideoId = videoId || (cleanedUrl ? parseYouTubeVideoId(cleanedUrl) : null);
      if (cleanedUrl && /\/shorts\//i.test(cleanedUrl)) {
        console.log('[yt-shorts]', { traceId, url: cleanedUrl, videoId: finalVideoId, normalized: normalizeYouTubeWatchUrl(cleanedUrl) });
      }
      if (!finalVideoId) {
        const errorCode = cleanedUrl && /\/shorts\//i.test(cleanedUrl) ? 'SHORTS_PARSE_ERROR' : 'INVALID_URL';
        return sendTranscriptError(res, {
          statusCode: 400,
          errorCode,
          message: mapLegacyDownloadError(errorCode).message,
          retryable: false,
          traceId,
          stage: 'youtube-download'
        });
      }
      finalUrl = normalizeYouTubeWatchUrl(finalVideoId) || `https://www.youtube.com/watch?v=${finalVideoId}`;
      traceLog(traceId, 'normalize', { platform: 'youtube', videoId: finalVideoId, shorts: /\/shorts\//i.test(cleanedUrl || '') });
    } else {
      if (!cleanedUrl) {
        return sendTranscriptError(res, {
          statusCode: 400,
          errorCode: 'INVALID_URL',
          message: mapLegacyDownloadError('INVALID_URL').message,
          retryable: false,
          traceId,
          stage: 'youtube-download'
        });
      }
      if (detectedPlatform === 'instagram') {
        finalUrl = normalizeInstagramUrl(cleanedUrl) || cleanedUrl;
        if (finalUrl.includes('/stories/')) {
          console.log('[instagram-story]', { traceId, url: finalUrl });
        }
      }
      traceLog(traceId, 'normalize', { platform: detectedPlatform, urlLen: (finalUrl || '').length });
    }

    const slot = await consumeDownloadSlotAtomic(userId, type, metadata);
    if (!slot.ok) {
      setCORSHeaders(res);
      const reason = slot.reason || 'Download not allowed for your plan.';
      const code = reason.includes('not available on your current plan')
        ? 'FEATURE_NOT_AVAILABLE'
        : reason.includes('past due') || reason.includes('expired')
          ? 'SUBSCRIPTION_INACTIVE'
          : 'LIMIT_EXCEEDED';
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        errorCode: code,
        code,
        message: reason,
        retryable: false,
        traceId,
        phase: 'youtube-download'
      });
    }

    downloadUserEmail = userId;
    slotConsumed = true;
    console.log(`[youtube-download] User ${userId} authorized for ${type} download from ${detectedPlatform}, download slot reserved`);

    console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: ${type} download for URL: ${finalUrl}, quality: ${quality}`);
    const isShorts = /youtube\.com\/shorts\//i.test(cleanedUrl);
    plog('DOWNLOAD_START', { detectedPlatform, type, quality });
    console.log('[download-start]', { traceId, platform: detectedPlatform, url: finalUrl?.slice(0, 120) });

    // Check runtime dependencies
    const ytDlpPath = await resolveYtDlpPath();
    try {
      const { stdout } = await execAsync(`${ytDlpPath} --version`);
      console.log('[ytdlp-version-debug]', { version: String(stdout || '').trim() || 'unknown', path: ytDlpPath });
    } catch {
      console.log('[ytdlp-version-debug]', { version: 'unknown', path: ytDlpPath });
    }
    traceLog(traceId, 'ffmpeg', { phase: 'dependency_check' });
    try {
      await execAsync('ffmpeg -version');
      plog('DEPENDENCY_OK', { dependency: 'ffmpeg' });
      traceLog(traceId, 'ffmpeg', { ok: true });
    } catch (ffmpegErr) {
      traceLog(traceId, 'ffmpeg', { ok: false, error: String(ffmpegErr?.message || ffmpegErr).slice(0, 200) });
      plog('DEPENDENCY_CHECK_FAILED', { dependency: 'ffmpeg', error: String(ffmpegErr?.message || ffmpegErr) });
      await refundDownloadSlotIfConsumed();
      return sendTranscriptError(res, {
        statusCode: 500,
        errorCode: 'FFMPEG_MISSING',
        message: 'ffmpeg is not available on server.',
        retryable: false,
        traceId,
        phase: 'ffmpeg'
      });
    }
    plog('DEPENDENCY_OK', { dependency: 'yt-dlp', ytDlpPath });
    const tempDir = tmpdir();
    const timestamp = Date.now();
    
    // Create a job directory for this download
    const jobDir = join(tempDir, `cutup_${timestamp}`);
    try {
      mkdirSync(jobDir, { recursive: true });
      traceLog(traceId, 'yt-dlp', { tempJobDirReady: true, suffix: jobDir.slice(-48) });
    } catch (tmpErr) {
      traceLog(traceId, 'failed', { reason: 'temp_dir', message: tmpErr?.message });
      plog('TMP_DIR_ERROR', { tempDir, jobDir, error: tmpErr?.message || String(tmpErr) });
      await refundDownloadSlotIfConsumed();
      return sendTranscriptError(res, {
        statusCode: 500,
        errorCode: 'TEMP_DIR_UNAVAILABLE',
        message: 'Temporary storage is not writable on server.',
        retryable: true,
        traceId,
        phase: 'normalize'
      });
    }
    plog('JOB_DIR_READY', { tempDir, jobDir, writable: existsSync(jobDir) });
    
    const outputTemplate = join(jobDir, 'out.%(ext)s');
    
    // Function to run yt-dlp once with a specific format selector
    async function runYtdlpOnce(
      formatSelector,
      useMerge = true,
      ytExtractorArgs = null,
      forceCookies = false,
      authExtraArgs = []
    ) {
      return new Promise((resolve, reject) => {
        const baseArgs = [
          '--no-playlist',
          '--no-warnings',
          '--no-check-certificate',
          '--no-mtime',
          '--print', 'after_move:filepath',
          '-o', outputTemplate,
        ];
        const effectiveExtractorArgs =
          detectedPlatform === 'youtube' && isShorts
            ? 'youtube:player_client=android'
            : ytExtractorArgs;
        if (effectiveExtractorArgs && detectedPlatform === 'youtube') {
          baseArgs.push('--extractor-args', effectiveExtractorArgs);
        }
        if (detectedPlatform === 'youtube' && forceCookies) {
          const cookiesPath = resolveCookiesPath();
          if (cookiesPath) {
            baseArgs.push('--cookies', cookiesPath);
          }
        }
        
        if (detectedPlatform === 'instagram') {
          baseArgs.push('--user-agent', INSTAGRAM_USER_AGENT);
          if (Array.isArray(authExtraArgs) && authExtraArgs.length) {
            baseArgs.push(...authExtraArgs);
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Auth args:`, authExtraArgs.slice(0, 2).join(' '));
          }
        }

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
        
        plog('YTDLP_COMMAND', {
          detectedPlatform,
          formatSelector,
          ytDlpPath,
          argsPreview: args.slice(0, 10),
          hasCookiesFlag: args.includes('--cookies') || args.includes('--cookies-from-browser')
        });
        console.log('[ytdlp-stream-debug]', {
          availableFormatsCount: null,
          selectedFormat: formatSelector,
          extractor: 'yt-dlp',
          playerClient: detectedPlatform === 'youtube' && isShorts ? 'android' : (ytExtractorArgs ? 'custom' : 'normal'),
          cookiesEnabled: args.includes('--cookies') || args.includes('--cookies-from-browser'),
          urlNormalized: originalUrl !== finalUrl
        });

        const p = spawn(ytDlpPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: jobDir
        });
        plog('YTDLP_SPAWNED', { pid: p.pid || null, timeoutMs: YTDLP_TIMEOUT_MS });
        traceLog(traceId, 'yt-dlp', {
          spawned: true,
          pid: p.pid || null,
          timeoutMs: YTDLP_TIMEOUT_MS,
          audio: type === 'audio'
        });

        let stdout = '';
        let stderr = '';
        let printedPath = null;
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          try {
            p.kill('SIGKILL');
          } catch (_e) {
            /* noop */
          }
        }, YTDLP_TIMEOUT_MS);

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
          clearTimeout(timeoutHandle);
          plog('YTDLP_EXIT', {
            detectedPlatform,
            code,
            timedOut,
            stdoutTail: stdout.slice(-1200),
            stderrTail: stderr.slice(-1200)
          });
          if (timedOut) {
            const err = new Error(`yt-dlp timeout after ${YTDLP_TIMEOUT_MS}ms`);
            err.stderr = stderr;
            err.stdout = stdout;
            err.code = 'YTDLP_TIMEOUT';
            return reject(err);
          }
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
          clearTimeout(timeoutHandle);
          plog('YTDLP_SPAWN_ERROR', { message: err?.message || String(err) });
          reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
        });
      });
    }

    async function runInstagramWithAuthAndFormats(formatChains, useMerge = true) {
      const authVariants = buildInstagramAuthVariants();
      let lastErr = null;
      for (const auth of authVariants) {
        for (let i = 0; i < formatChains.length; i++) {
          const formatSelector = formatChains[i];
          try {
            console.log(
              `${detectedPlatform.toUpperCase()}_DOWNLOAD: Auth ${auth.label}, format ${i + 1}/${formatChains.length}: ${formatSelector}`
            );
            const result = await runYtdlpOnce(formatSelector, useMerge, null, false, auth.extraArgs);
            console.log(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Success (${auth.label}, ${formatSelector})`);
            return result;
          } catch (e) {
            lastErr = e;
            const stderr = String(e?.stderr ?? e?.message ?? '');
            const isFormatNotAvailable =
              stderr.includes('Requested format is not available') ||
              stderr.includes('format is not available');
            if (isFormatNotAvailable && i < formatChains.length - 1) continue;
            if (isInstagramAuthBlock(stderr) && auth !== authVariants[authVariants.length - 1]) {
              console.warn(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Auth blocked (${auth.label}), trying next…`);
              break;
            }
            if (i === formatChains.length - 1 && auth === authVariants[authVariants.length - 1]) throw e;
          }
        }
      }
      throw lastErr || new Error('No available formats found for this URL');
    }

    // Function to run yt-dlp with format fallback chain for Instagram/TikTok
    async function runYtdlpWithFallback() {
      if (type === 'audio') {
        if (detectedPlatform === 'instagram') {
          return await runInstagramWithAuthAndFormats(['bestaudio/best'], false);
        }
        return await runYtdlpOnce('bestaudio/best', false);
      }

      if (detectedPlatform === 'instagram') {
        const formatChains = [
          'bv*+ba/b',
          'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
          'b[ext=mp4]/b',
          'b'
        ];
        if (quality !== 'best') {
          const height = quality.replace('p', '');
          formatChains.unshift(
            `bv*[height<=${height}]+ba/b[height<=${height}]`,
            `bv[height<=${height}]*+ba/b[height<=${height}]`
          );
        }
        return await runInstagramWithAuthAndFormats(formatChains, true);
      }

      if (detectedPlatform === 'tiktok') {
        // Format fallback chain for TikTok
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
      }

      {
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
        
        const preferred = videoFormats[quality] || 'bestvideo+bestaudio';
        const formatChain = [preferred, 'bestvideo+bestaudio', 'best', 'mp4', 'worst'];
        const clientProfiles = [
          { profile: 'normal', extractorArgs: null, forceCookies: false },
          { profile: 'android', extractorArgs: 'youtube:player_client=android', forceCookies: false },
          { profile: 'tv_embedded', extractorArgs: 'youtube:player_client=tv_embedded', forceCookies: false },
          { profile: 'cookies', extractorArgs: null, forceCookies: true }
        ];
        let lastErr = null;
        for (const formatSelector of formatChain) {
          for (const client of clientProfiles) {
            try {
              console.log('[ytdlp-debug]', {
                traceId,
                extractor: 'yt-dlp',
                clientProfile: client.profile,
                retries: 0,
                cookiesEnabled: client.forceCookies,
                selectedFormat: formatSelector,
                urlNormalized: originalUrl !== finalUrl
              });
              const result = await runYtdlpOnce(formatSelector, true, client.extractorArgs, client.forceCookies);
              return result;
            } catch (err) {
              lastErr = err;
            }
          }
        }
        throw lastErr || new Error('Could not extract video stream');
      }
    }
    
    try {
      extractionDebug(traceId, { phase: 'download_enqueue', url: finalUrl, platform: detectedPlatform });
      const invokeResult = await runQueuedDownload({
        url: finalUrl,
        userEmail: userId,
        traceId,
        fn: async () => {
          traceLog(traceId, 'yt-dlp', { phase: 'invoke', platform: detectedPlatform });
          await applyYtdlpBurstDelay(userId);
          let result = null;
          let invokeError = null;
          for (let attempt = 1; attempt <= YTDLP_MAX_RETRIES; attempt++) {
            try {
              console.log('[ytdlp-debug]', {
                traceId,
                extractor: 'yt-dlp',
                clientProfile: 'fallback_chain',
                retries: attempt,
                cookiesEnabled: Boolean(resolveCookiesPath())
              });
              result = await runYtdlpWithFallback();
              break;
            } catch (err) {
              invokeError = err;
              const mapped = classifyYtDlpError(err?.stderr || err?.message || '');
              if (!mapped.temporary || attempt >= YTDLP_MAX_RETRIES) break;
              const backoffMs = Math.min(4000, 320 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 240);
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
          if (!result) throw invokeError || new Error('Could not extract video stream');
          return result;
        }
      });
      const { filepath, stdout, stderr } = invokeResult;
      
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

      traceLog(traceId, 'audio-download', { bytes: fileSize, ext: fileExt, contentType });
      
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
      
      traceLog(traceId, 'success', { phase: 'stream_start', bytes: fileSize, platform: detectedPlatform });

      // Clean up only after response is fully sent
      res.on('finish', safeCleanup);
      res.on('close', safeCleanup);
      
      // Stream file instead of reading into memory
      const fileStream = createReadStream(outputFile);
      
      fileStream.on('error', async (streamError) => {
        console.error(`${detectedPlatform.toUpperCase()}_DOWNLOAD: Stream error:`, streamError);
        safeCleanup();
        if (!res.headersSent) {
          await refundDownloadSlotIfConsumed();
          return sendTranscriptError(res, {
            statusCode: 500,
            errorCode: 'DOWNLOAD_FAILED',
            message: streamError.message || 'Error streaming downloaded file.',
            retryable: true,
            traceId,
            phase: 'audio-download'
          });
        } else {
          res.destroy(streamError);
        }
      });
      
      fileStream.pipe(res);
      plog('DOWNLOAD_STREAMING', { detectedPlatform, fileSize, outputFile });

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
    console.error('[download-failed]', { traceId, message: error?.message });
    if (error.stderr) console.error('[extractor-failed] stderr:', String(error.stderr).slice(-800));
    if (error.stdout) console.error('[extractor-failed] stdout:', String(error.stdout).slice(-800));

    await refundDownloadSlotIfConsumed();

    setCORSHeaders(res);

    const { url, platform } = req.body || {};
    const cleaned = url ? stripTrackingQueryParams(url) : '';
    const detectedPlatform = platform || detectPlatformFromUrl(cleaned) || 'youtube';

    const stderrText = String(error.stderr || '').toLowerCase();
    const stdoutText = String(error.stdout || '').toLowerCase();
    const ytdlpClass = classifyYtDlpError(error.stderr || error.message || '');
    let legacyCode = 'DOWNLOAD_ERROR';
    if (String(error.code || '') === 'YTDLP_TIMEOUT' || stderrText.includes('timed out') || stderrText.includes('timeout')) {
      legacyCode = 'YTDLP_TIMEOUT';
    } else if (stderrText.includes('ffmpeg') && (stderrText.includes('not found') || stderrText.includes('not installed'))) {
      legacyCode = 'FFMPEG_MISSING';
    } else if (
      stderrText.includes('cookies') ||
      stderrText.includes('login required') ||
      stderrText.includes('you need to log in') ||
      (detectedPlatform === 'instagram' && isInstagramAuthBlock(stderrText))
    ) {
      legacyCode = 'SOCIAL_LOGIN_REQUIRED';
    } else if (stderrText.includes('private') || stderrText.includes('not available') || stderrText.includes('unable to extract')) {
      legacyCode = 'MEDIA_UNAVAILABLE';
    } else if (stderrText.includes('unsupported url') || stderrText.includes('unsupported')) {
      legacyCode = 'UNSUPPORTED_URL';
    } else if (stderrText.includes('spawn') || stdoutText.includes('spawn')) {
      legacyCode = 'YTDLP_SPAWN_FAILED';
    } else if (detectedPlatform === 'instagram') {
      legacyCode = 'INSTAGRAM_EXTRACTION_FAILED';
      console.log('[instagram-story]', { traceId, failed: true, url: cleaned?.slice(0, 80) });
    } else if (detectedPlatform === 'tiktok') {
      legacyCode = 'TIKTOK_EXTRACTION_FAILED';
    }

    if (ytdlpClass.code === 'YTDLP_TEMP_BLOCK') legacyCode = 'YTDLP_TIMEOUT';
    if (ytdlpClass.code === 'YTDLP_AUTH_REQUIRED') legacyCode = 'SOCIAL_LOGIN_REQUIRED';
    if (ytdlpClass.code === 'YTDLP_VIDEO_UNAVAILABLE') legacyCode = 'MEDIA_UNAVAILABLE';

    const mapped = mapLegacyDownloadError(legacyCode, { message: error.message, platform: detectedPlatform });
    plog('DOWNLOAD_FAILED', {
      detectedPlatform,
      mappedCode: mapped.errorCode,
      legacyCode,
      stderrTail: stderrText.slice(-1200)
    });
    return sendTranscriptError(res, {
      statusCode: mapped.errorCode === 'VIDEO_UNAVAILABLE' ? 422 : 500,
      errorCode: mapped.errorCode,
      message: ytdlpClass.message || mapped.message,
      retryable: mapped.retryable !== false,
      traceId,
      stage: 'youtube-download'
    });
  }
}
