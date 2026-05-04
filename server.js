import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import sitemapHandler from './api/sitemap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', 1);
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

  if (process.env.DATABASE_URL) {
    console.log('✅ DATABASE_URL is set (subscription + usage persistence enabled)');
  } else {
    console.warn('⚠️ DATABASE_URL is NOT set — /api/subscription and Stripe webhooks will return 503 until configured');
  }
  
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Session-Id'],
  credentials: false
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Session-Id');
  res.sendStatus(200);
});

// Stripe webhook must receive raw body (before express.json)
let stripeWebhookHandler = null;
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripeWebhookHandler) {
    return res.status(503).json({ error: 'Stripe webhook handler not loaded' });
  }
  return stripeWebhookHandler(req, res);
});

// Body parser middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dynamic sitemap route for self-hosted deployments.
// Keep this before any potential static file middleware so /sitemap.xml is always generated dynamically.
app.get('/sitemap.xml', async (req, res) => sitemapHandler(req, res));

// Import and use API routes
let uploadHandler, transcribeHandler, summarizeHandler, youtubeHandler, translateSrtHandler, youtubeTitleHandler, authHandler, youtubeDownloadHandler, youtubeFormatsHandler, subscriptionHandler, oauthGoogleStartHandler, generateDocxHandler, stripeCheckoutHandler, paymentCreateHandler, paymentVerifyHandler, analyticsHandler, adminHandler, adminUsersManageHandler, adminLoginHandler, adminLogoutHandler, adminAuthMeHandler, adminForgotPasswordHandler, adminResetPasswordHandler, toolsContentHandler, pingGoogleHandler, growthDecisionHandler, growthTrackHandler, retentionHandler, leadsHandler, contactHandler, cronConversionEmailsHandler, userProfileHandler;

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
    
    try {
      const stripeWh = await import('./api/stripe-webhook.js');
      stripeWebhookHandler = stripeWh.default;
      console.log('✅ Stripe webhook handler loaded');
    } catch (err) {
      console.error('❌ Stripe webhook handler failed to load:', err.message);
      stripeWebhookHandler = null;
    }

    const stripeCh = await import('./api/stripe-checkout.js');
    stripeCheckoutHandler = stripeCh.default;
    console.log('✅ Stripe checkout handler loaded');

    const paymentCreateModule = await import('./api/payment-create.js');
    paymentCreateHandler = paymentCreateModule.default;
    const paymentVerifyModule = await import('./api/payment-verify.js');
    paymentVerifyHandler = paymentVerifyModule.default;
    console.log('✅ Payment create/verify handlers loaded');

    const adminModule = await import('./api/admin.js');
    adminHandler = adminModule.default;
    console.log('✅ Admin handler loaded');

    const adminUsersManageModule = await import('./api/admin-users-manage.js');
    adminUsersManageHandler = adminUsersManageModule.default;
    console.log('✅ Admin customer user manage handler loaded');

    const adminLoginModule = await import('./api/admin-login.js');
    adminLoginHandler = adminLoginModule.default;
    const adminLogoutModule = await import('./api/admin-logout.js');
    adminLogoutHandler = adminLogoutModule.default;
    const adminAuthMeModule = await import('./api/admin-auth-me.js');
    adminAuthMeHandler = adminAuthMeModule.default;
    const adminForgotModule = await import('./api/admin-forgot-password.js');
    adminForgotPasswordHandler = adminForgotModule.default;
    const adminResetModule = await import('./api/admin-reset-password.js');
    adminResetPasswordHandler = adminResetModule.default;
    console.log('✅ Admin panel auth handlers loaded');

    const { ensureAdminsSchema, syncPrimaryAdminAccount } = await import('./api/admins-repository.js');
    await ensureAdminsSchema();
    await syncPrimaryAdminAccount();

    const toolsContentModule = await import('./api/tools-content.js');
    toolsContentHandler = toolsContentModule.default;
    console.log('✅ Tools content handler loaded');

    const pingGoogleModule = await import('./api/ping-google.js');
    pingGoogleHandler = pingGoogleModule.default;
    console.log('✅ Ping Google handler loaded');

    const growthDecisionModule = await import('./api/growth-decision.js');
    growthDecisionHandler = growthDecisionModule.default;
    const growthTrackModule = await import('./api/growth-track.js');
    growthTrackHandler = growthTrackModule.default;
    console.log('✅ Growth Brain handlers loaded');

    const retentionModule = await import('./api/retention.js');
    retentionHandler = retentionModule.default;
    console.log('✅ Retention handler loaded');

    const analyticsModule = await import('./api/analytics.js');
    analyticsHandler = analyticsModule.default;
    console.log('✅ Analytics handler loaded');

    const leadsModule = await import('./api/leads.js');
    leadsHandler = leadsModule.default;
    const contactModule = await import('./api/contact.js');
    contactHandler = contactModule.default;
    const cronConvModule = await import('./api/cron-conversion-emails.js');
    cronConversionEmailsHandler = cronConvModule.default;
    console.log('✅ Leads + conversion cron handlers loaded');

    const userProfileModule = await import('./api/user-profile.js');
    userProfileHandler = userProfileModule.default;
    console.log('✅ User profile handler loaded');

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
  try {
    if (generateDocxHandler) {
      await generateDocxHandler(req, res);
    } else {
      console.error('[server] Generate DOCX handler not loaded');
      res.status(503).json({ 
        error: 'Service unavailable',
        message: 'DOCX generation service is not available. Please check server logs.'
      });
    }
  } catch (error) {
    console.error('[server] Error in Generate DOCX route:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

app.post('/api/subscription', async (req, res) => {
  if (!subscriptionHandler) {
    return res.status(500).json({ error: 'Subscription handler not loaded' });
  }
  return subscriptionHandler(req, res);
});

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  if (!stripeCheckoutHandler) {
    return res.status(503).json({ error: 'Stripe checkout not loaded' });
  }
  return stripeCheckoutHandler(req, res);
});

app.post('/api/payment/create', async (req, res) => {
  if (!paymentCreateHandler) {
    return res.status(503).json({ error: 'Payment create not loaded' });
  }
  return paymentCreateHandler(req, res);
});

app.post('/api/payment/verify', async (req, res) => {
  if (!paymentVerifyHandler) {
    return res.status(503).json({ error: 'Payment verify not loaded' });
  }
  return paymentVerifyHandler(req, res);
});

app.post('/api/analytics', async (req, res) => {
  if (!analyticsHandler) {
    return res.status(503).json({ ok: false });
  }
  return analyticsHandler(req, res);
});

app.post('/api/leads', async (req, res) => {
  if (!leadsHandler) {
    return res.status(503).json({ ok: false });
  }
  return leadsHandler(req, res);
});

app.post('/api/contact', async (req, res) => {
  if (!contactHandler) {
    return res.status(503).json({ ok: false });
  }
  return contactHandler(req, res);
});

app.get('/api/cron/conversion-emails', async (req, res) => {
  if (!cronConversionEmailsHandler) {
    return res.status(503).json({ ok: false });
  }
  return cronConversionEmailsHandler(req, res);
});

app.post('/api/cron/conversion-emails', async (req, res) => {
  if (!cronConversionEmailsHandler) {
    return res.status(503).json({ ok: false });
  }
  return cronConversionEmailsHandler(req, res);
});

app.get('/api/user/profile', async (req, res) => {
  if (!userProfileHandler) {
    return res.status(503).json({ error: 'User profile handler not loaded' });
  }
  return userProfileHandler(req, res);
});

app.post('/api/user/profile', async (req, res) => {
  if (!userProfileHandler) {
    return res.status(503).json({ error: 'User profile handler not loaded' });
  }
  return userProfileHandler(req, res);
});

app.get('/api/admin', async (req, res) => {
  if (!adminHandler) {
    return res.status(503).json({ error: 'Admin handler not loaded' });
  }
  return adminHandler(req, res);
});

app.post('/api/admin', async (req, res) => {
  if (!adminHandler) {
    return res.status(503).json({ error: 'Admin handler not loaded' });
  }
  return adminHandler(req, res);
});

app.patch('/api/admin/users/:id', async (req, res) => {
  if (!adminUsersManageHandler) {
    return res.status(503).json({ error: 'Admin users handler not loaded' });
  }
  return adminUsersManageHandler(req, res);
});

app.delete('/api/admin/users/:id', async (req, res) => {
  if (!adminUsersManageHandler) {
    return res.status(503).json({ error: 'Admin users handler not loaded' });
  }
  return adminUsersManageHandler(req, res);
});

app.post('/api/admin/login', async (req, res) => {
  if (!adminLoginHandler) {
    return res.status(503).json({ ok: false, error: 'not_loaded' });
  }
  return adminLoginHandler(req, res);
});

app.post('/api/admin/logout', async (req, res) => {
  if (!adminLogoutHandler) {
    return res.status(503).json({ ok: false });
  }
  return adminLogoutHandler(req, res);
});

app.get('/api/admin/auth/me', async (req, res) => {
  if (!adminAuthMeHandler) {
    return res.status(503).json({ ok: false });
  }
  return adminAuthMeHandler(req, res);
});

app.post('/api/admin/forgot-password', async (req, res) => {
  if (!adminForgotPasswordHandler) {
    return res.status(503).json({ ok: false });
  }
  return adminForgotPasswordHandler(req, res);
});

app.post('/api/admin/reset-password', async (req, res) => {
  if (!adminResetPasswordHandler) {
    return res.status(503).json({ ok: false });
  }
  return adminResetPasswordHandler(req, res);
});

app.get('/api/tools-content', async (req, res) => {
  if (!toolsContentHandler) {
    return res.status(503).json({ error: 'Tools content handler not loaded' });
  }
  return toolsContentHandler(req, res);
});

app.get('/api/ping-google', async (req, res) => {
  if (!pingGoogleHandler) {
    return res.status(503).json({ error: 'Ping Google handler not loaded' });
  }
  return pingGoogleHandler(req, res);
});

app.get('/api/growth/decision', async (req, res) => {
  if (!growthDecisionHandler) {
    return res.status(503).json({ error: 'Growth decision handler not loaded' });
  }
  return growthDecisionHandler(req, res);
});

app.post('/api/growth/track', async (req, res) => {
  if (!growthTrackHandler) {
    return res.status(503).json({ ok: false });
  }
  return growthTrackHandler(req, res);
});

app.post('/api/retention', async (req, res) => {
  if (!retentionHandler) {
    return res.status(503).json({ error: 'Retention handler not loaded' });
  }
  return retentionHandler(req, res);
});

// Static site (HTML, assets) — after API routes so /api/* is not shadowed.
app.use(express.static(join(__dirname, 'website')));
app.use(express.static(join(__dirname, 'public')));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 handler — any unknown route (including missing files)
app.use((req, res) => {
  res.status(404).sendFile(join(__dirname, 'public/404.html'));
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
    console.log(`   POST /api/stripe/create-checkout-session`);
    console.log(`   POST /api/payment/create`);
    console.log(`   POST /api/payment/verify`);
    console.log(`   POST /api/analytics`);
    console.log(`   POST /api/leads`);
    console.log(`   POST /api/contact`);
    console.log(`   GET  /api/cron/conversion-emails`);
    console.log(`   POST /api/stripe/webhook`);
    console.log(`   GET  /api/admin?action=overview`);
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

