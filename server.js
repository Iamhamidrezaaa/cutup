import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Load environment variables
console.log('📂 Loading .env file from:', join(__dirname, '.env'));
try {
  const envFile = readFileSync(join(__dirname, '.env'), 'utf8');
  console.log('✅ .env file read successfully, size:', envFile.length, 'bytes');
  let loadedCount = 0;
  envFile.split('\n').forEach((line, index) => {
    const trimmedLine = line.trim();
    // Skip comments and empty lines
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        if (key && cleanValue) {
          process.env[key] = cleanValue;
          loadedCount++;
          // Log API key prefix for debugging (don't log full key)
          if (key === 'OPENAI_API_KEY') {
            console.log(`✅ Loaded ${key}: ${cleanValue.substring(0, 20)}...${cleanValue.substring(cleanValue.length - 10)} (length: ${cleanValue.length})`);
          }
        }
      }
    }
  });
  console.log(`✅ Loaded ${loadedCount} environment variables from .env file`);
  
  // Verify API key is set
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log(`✅ OPENAI_API_KEY is set: ${apiKey.substring(0, 20)}...${apiKey.substring(apiKey.length - 10)} (length: ${apiKey.length})`);
  } else {
    console.error('❌ OPENAI_API_KEY is NOT set after loading .env file!');
  }
} catch (err) {
  console.error('⚠️ Error loading .env file:', err.message);
  console.error('⚠️ Stack:', err.stack);
  // Check if API key exists in process.env (from PM2 or system)
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log(`⚠️ Using OPENAI_API_KEY from environment: ${apiKey.substring(0, 20)}...${apiKey.substring(apiKey.length - 10)}`);
  } else {
    console.error('❌ OPENAI_API_KEY not found in environment variables!');
  }
}

// CORS middleware - Allow all origins for Chrome Extension
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: false
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.sendStatus(200);
});

// Body parser middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Import and use API routes
let uploadHandler, transcribeHandler, summarizeHandler, youtubeHandler, translateSrtHandler, youtubeTitleHandler, authHandler, youtubeDownloadHandler, youtubeFormatsHandler, subscriptionHandler, oauthGoogleStartHandler, generateDocxHandler;

async function loadRoutes() {
  try {
    // Upload endpoint
    const uploadModule = await import('./api/upload.js');
    uploadHandler = uploadModule.default;
    
    // Transcribe endpoint
    const transcribeModule = await import('./api/transcribe.js');
    transcribeHandler = transcribeModule.default;
    
    // Summarize endpoint
    const summarizeModule = await import('./api/summarize.js');
    summarizeHandler = summarizeModule.default;
    
    // YouTube endpoint
    const youtubeModule = await import('./api/youtube.js');
    youtubeHandler = youtubeModule.default;
    
    // YouTube Title endpoint
    const youtubeTitleModule = await import('./api/youtube-title.js');
    youtubeTitleHandler = youtubeTitleModule.default;
    
    // Translate SRT endpoint
    const translateSrtModule = await import('./api/translate-srt.js');
    translateSrtHandler = translateSrtModule.default;
    
    // Auth endpoint
    const authModule = await import('./api/auth.js');
    authHandler = authModule.default;
    
    // OAuth Google Start endpoint
    try {
      const oauthGoogleStartModule = await import('./api/oauth-google-start.js');
      oauthGoogleStartHandler = oauthGoogleStartModule.default;
      console.log('✅ OAuth Google Start handler loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load OAuth Google Start handler:', err);
      throw err;
    }
    
    // YouTube Download endpoint
    const youtubeDownloadModule = await import('./api/youtube-download.js');
    youtubeDownloadHandler = youtubeDownloadModule.default;
    
    // YouTube Formats endpoint
    const youtubeFormatsModule = await import('./api/youtube-formats.js');
    youtubeFormatsHandler = youtubeFormatsModule.default;
    
    // Subscription endpoint
    const subscriptionModule = await import('./api/subscription.js');
    subscriptionHandler = subscriptionModule.default;
    
    // Generate DOCX endpoint
    try {
      const generateDocxModule = await import('./api/generate-docx.js');
      generateDocxHandler = generateDocxModule.default;
      console.log('✅ Generate DOCX handler loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load Generate DOCX handler:', err);
      console.error('   Error details:', err.message);
      console.error('   Stack:', err.stack);
      // Don't throw - make it optional
      generateDocxHandler = null;
    }
    
    console.log('All routes loaded successfully');
  } catch (err) {
    console.error('Error loading routes:', err);
    throw err;
  }
}

// API Routes
app.post('/api/upload', async (req, res) => {
  if (!uploadHandler) {
    return res.status(500).json({ error: 'Upload handler not loaded' });
  }
  return uploadHandler(req, res);
});

app.post('/api/transcribe', async (req, res) => {
  if (!transcribeHandler) {
    return res.status(500).json({ error: 'Transcribe handler not loaded' });
  }
  return transcribeHandler(req, res);
});

app.post('/api/summarize', async (req, res) => {
  if (!summarizeHandler) {
    return res.status(500).json({ error: 'Summarize handler not loaded' });
  }
  return summarizeHandler(req, res);
});

app.post('/api/youtube', async (req, res) => {
  if (!youtubeHandler) {
    return res.status(500).json({ error: 'YouTube handler not loaded' });
  }
  return youtubeHandler(req, res);
});

app.post('/api/youtube-title', async (req, res) => {
  if (!youtubeTitleHandler) {
    return res.status(500).json({ error: 'YouTube Title handler not loaded' });
  }
  return youtubeTitleHandler(req, res);
});

app.post('/api/translate-srt', async (req, res) => {
  if (!translateSrtHandler) {
    return res.status(500).json({ error: 'Translate SRT handler not loaded' });
  }
  return translateSrtHandler(req, res);
});

// Auth routes - handle both GET and POST
app.get('/api/auth', async (req, res) => {
  if (!authHandler) {
    return res.status(500).json({ error: 'Auth handler not loaded' });
  }
  return authHandler(req, res);
});

app.post('/api/auth', async (req, res) => {
  if (!authHandler) {
    return res.status(500).json({ error: 'Auth handler not loaded' });
  }
  return authHandler(req, res);
});

app.get('/api/auth/callback', async (req, res) => {
  if (!authHandler) {
    return res.status(500).json({ error: 'Auth handler not loaded' });
  }
  // Set action to 'callback' for this route
  req.query.action = 'callback';
  return authHandler(req, res);
});

// OAuth Google Start route - separate endpoint to avoid conflicts
app.post('/api/oauth/google/start', async (req, res) => {
  try {
    if (!oauthGoogleStartHandler) {
      console.error('[server] OAuth Google Start handler not loaded');
      return res.status(500).json({ error: 'OAuth Google Start handler not loaded' });
    }
    await oauthGoogleStartHandler(req, res);
  } catch (error) {
    console.error('[server] Error in OAuth Google Start route:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// YouTube Download routes
app.post('/api/youtube-download', async (req, res) => {
  if (!youtubeDownloadHandler) {
    return res.status(500).json({ error: 'YouTube Download handler not loaded' });
  }
  return youtubeDownloadHandler(req, res);
});

app.post('/api/youtube-formats', async (req, res) => {
  if (!youtubeFormatsHandler) {
    return res.status(500).json({ error: 'YouTube Formats handler not loaded' });
  }
  return youtubeFormatsHandler(req, res);
});

// Subscription routes
app.get('/api/subscription', async (req, res) => {
  if (!subscriptionHandler) {
    return res.status(500).json({ error: 'Subscription handler not loaded' });
  }
  return subscriptionHandler(req, res);
});

app.post('/api/generate-docx', async (req, res) => {
  if (generateDocxHandler) {
    await generateDocxHandler(req, res);
  } else {
    res.status(503).json({ error: 'Service unavailable' });
  }
});

app.post('/api/subscription', async (req, res) => {
  if (!subscriptionHandler) {
    return res.status(500).json({ error: 'Subscription handler not loaded' });
  }
  return subscriptionHandler(req, res);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
loadRoutes().then(() => {
  const server = createServer(app);
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT} (PID: ${process.pid})`);
    console.log(`📡 API endpoints:`);
    console.log(`   POST /api/upload`);
    console.log(`   POST /api/transcribe`);
    console.log(`   POST /api/summarize`);
    console.log(`   POST /api/youtube`);
    console.log(`   POST /api/youtube-title`);
    console.log(`   POST /api/translate-srt`);
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/auth?action=login`);
    console.log(`   GET  /api/auth/callback`);
    console.log(`   GET  /api/auth?action=me`);
    console.log(`   POST /api/auth?action=logout`);
    console.log(`   POST /api/youtube-download`);
    console.log(`   POST /api/youtube-formats`);
    console.log(`   GET  /api/subscription?action=info`);
    console.log(`   POST /api/subscription?action=check`);
    console.log(`   POST /api/subscription?action=upgrade`);
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Please stop the process using this port.`);
      console.error(`   Run: lsof -i :${PORT} or kill -9 $(lsof -t -i:${PORT})`);
    } else {
      console.error('❌ Server error:', err);
    }
    process.exit(1);
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

