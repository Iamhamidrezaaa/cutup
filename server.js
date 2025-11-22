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
try {
  const envFile = readFileSync(join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      process.env[key.trim()] = values.join('=').trim();
    }
  });
} catch (err) {
  console.warn('No .env file found, using environment variables');
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
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Import and use API routes
let uploadHandler, transcribeHandler, summarizeHandler;

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
    console.log(`   GET  /health`);
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

