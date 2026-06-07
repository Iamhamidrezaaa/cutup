import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
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

void import('./api/transcription/init.js')
  .then((m) => m.initTranscriptionProviders())
  .catch((e) => console.warn('[transcription] provider init failed:', e?.message || e));

void import('./api/yekpay.js')
  .then((m) => m.logYekpayStartupOnce())
  .catch((e) => console.warn('[yekpay] startup log unavailable:', e?.message || e));

// CORS middleware - Allow all origins for Chrome Extension
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Session-Id', 'X-Analytics-Session-Id'],
  credentials: false
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Session-Id, X-Analytics-Session-Id');
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

const { extractionRateLimitMiddleware } = await import('./api/infrastructure/guards.js');
const rateLimit = extractionRateLimitMiddleware;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/system-health', async (req, res) => {
  if (!systemHealthHandler) {
    return res.status(503).json({ ok: false, degraded: true, error: 'system_health_not_loaded' });
  }
  return systemHealthHandler(req, res);
});

// Dynamic sitemap route for self-hosted deployments.
// Keep this before any potential static file middleware so /sitemap.xml is always generated dynamically.
app.get('/sitemap.xml', async (req, res) => sitemapHandler(req, res));

// Import and use API routes
let uploadHandler, adminCmsMediaHandler, transcribeHandler, summarizeHandler, youtubeHandler, translateSrtHandler, youtubeTitleHandler, authHandler, youtubeDownloadHandler, youtubeFormatsHandler, subscriptionHandler, projectsHandler, oauthGoogleStartHandler, generateDocxHandler, exportVideoHandler, stripeCheckoutHandler, stripePortalHandler, paymentCreateHandler, paymentVerifyHandler, paymentCallbackHandler, paymentRetryHandler, invoicesHandler, invoiceByIdHandler, analyticsHandler, adminHandler, adminUsersManageHandler, adminLoginHandler, adminLogoutHandler, adminAuthMeHandler, adminForgotPasswordHandler, adminResetPasswordHandler, toolsContentHandler, pingGoogleHandler, growthDecisionHandler, growthTrackHandler, retentionHandler, leadsHandler, contactHandler, cronConversionEmailsHandler, userProfileHandler, accountSecurityHandler, auditEventHandler, adminAuditSummaryHandler, adminAuditListHandler, adminAuditUserTimelineHandler, adminAuditChartsHandler, adminAuditFunnelHandler, adminAuditAlertsHandler, adminAuditEvaluateAlertsHandler, adminAuditSeedHandler, adminAuditDashboardHandler, adminAuditJourneyHandler, adminAuditNotesHandler, adminAuditExportHandler, offersHandler, adminOffersHandler, creatorWallHandler, adminCreatorWallHandler, systemHealthHandler, adminOpsStateHandler, adminProvidersHandler;

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

    try {
      const projectsModule = await import('./api/projects.js');
      projectsHandler = projectsModule.default;
      console.log('✅ Projects handler loaded');
    } catch (err) {
      console.error('❌ Failed to load projects handler:', err.message);
      projectsHandler = null;
    }
    
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
      const exportVideoModule = await import('./api/export-video.js');
      exportVideoHandler = exportVideoModule.default;
      console.log('✅ Export video (viral burn-in) handler loaded');
    } catch (err) {
      console.error('❌ Failed to load export-video handler:', err.message);
      exportVideoHandler = null;
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
    const stripePortalModule = await import('./api/stripe-portal.js');
    stripePortalHandler = stripePortalModule.default;
    console.log('✅ Stripe checkout + portal handlers loaded');

    const paymentCreateModule = await import('./api/payment-create.js');
    paymentCreateHandler = paymentCreateModule.default;
    const paymentVerifyModule = await import('./api/payment-verify.js');
    paymentVerifyHandler = paymentVerifyModule.default;
    const paymentCallbackModule = await import('./api/payment-callback.js');
    paymentCallbackHandler = paymentCallbackModule.default;
    const paymentRetryModule = await import('./api/payment-retry.js');
    paymentRetryHandler = paymentRetryModule.default;
    const invoicesModule = await import('./api/invoices.js');
    invoicesHandler = invoicesModule.default;
    const invoiceByIdModule = await import('./api/invoice-by-id.js');
    invoiceByIdHandler = invoiceByIdModule.default;
    console.log('✅ Payment create/verify/callback/retry/invoice handlers loaded');

    const adminModule = await import('./api/admin.js');
    adminHandler = adminModule.default;
    console.log('✅ Admin handler loaded');

    const adminCmsMediaModule = await import('./api/admin-cms-media.js');
    adminCmsMediaHandler = adminCmsMediaModule.default;
    console.log('✅ Admin CMS media upload loaded');

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

    const adminOpsStateModule = await import('./api/admin-ops-state.js');
    adminOpsStateHandler = adminOpsStateModule.default;
    console.log('✅ Admin ops state handler loaded');

    const adminProvidersModule = await import('./api/admin/providers.js');
    adminProvidersHandler = adminProvidersModule.default;
    console.log('✅ Admin transcription providers handler loaded');

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

    try {
      const cwBootstrap = await import('./api/creator-wall-bootstrap.js');
      await cwBootstrap.ensureCreatorWallSchema();
      console.log('✅ Creator Wall schema ensured');
    } catch (e) {
      console.warn('⚠️ Creator Wall schema:', e?.message);
    }
    const creatorWallModule = await import('./api/creator-wall.js');
    creatorWallHandler = creatorWallModule.default;
    const adminCreatorWallModule = await import('./api/admin-creator-wall.js');
    adminCreatorWallHandler = adminCreatorWallModule.default;
    console.log('✅ Creator Wall handlers loaded');

    const contactModule = await import('./api/contact.js');
    contactHandler = contactModule.default;
    const cronConvModule = await import('./api/cron-conversion-emails.js');
    cronConversionEmailsHandler = cronConvModule.default;
    console.log('✅ Leads + conversion cron handlers loaded');

    const userProfileModule = await import('./api/user-profile.js');
    userProfileHandler = userProfileModule.default;
    console.log('✅ User profile handler loaded');

    const accountSecurityModule = await import('./api/account-security.js');
    accountSecurityHandler = accountSecurityModule.default;
    try {
      const { ensureAccountSecuritySchema } = await import('./api/account-security-repository.js');
      await ensureAccountSecuritySchema();
    } catch (e) {
      console.warn('⚠️ Account security schema:', e?.message);
    }
    console.log('✅ Account security handler loaded');

    try {
      const offersBootstrapModule = await import('./api/offers-bootstrap.js');
      const schemaInit = await offersBootstrapModule.ensureOffersSchema();
      if (!schemaInit.ok) console.warn('⚠️ offers schema bootstrap degraded:', schemaInit.reason || schemaInit.error);
      else console.log('✅ Offers schema bootstrap ensured');
      await offersBootstrapModule.logOffersSchemaCheck();
    } catch (e) {
      console.warn('⚠️ Offers schema bootstrap failed (degraded mode):', e?.message || e);
    }

    const offersModule = await import('./api/offers.js');
    offersHandler = offersModule.default;
    const adminOffersModule = await import('./api/admin-offers.js');
    adminOffersHandler = adminOffersModule.default;
    console.log('✅ Offers handlers loaded');

    const systemHealthModule = await import('./api/system-health.js');
    systemHealthHandler = systemHealthModule.default;
    console.log('✅ System health handler loaded');

    const auditEventModule = await import('./api/audit-event.js');
    auditEventHandler = auditEventModule.default;
    const adminAuditModule = await import('./api/admin-audit.js');
    adminAuditSummaryHandler = adminAuditModule.adminAuditSummaryHandler;
    adminAuditListHandler = adminAuditModule.adminAuditListHandler;
    adminAuditUserTimelineHandler = adminAuditModule.adminAuditUserTimelineHandler;
    adminAuditChartsHandler = adminAuditModule.adminAuditChartsHandler;
    adminAuditFunnelHandler = adminAuditModule.adminAuditFunnelHandler;
    adminAuditAlertsHandler = adminAuditModule.adminAuditAlertsHandler;
    adminAuditEvaluateAlertsHandler = adminAuditModule.adminAuditEvaluateAlertsHandler;
    adminAuditSeedHandler = adminAuditModule.adminAuditSeedHandler;
    adminAuditDashboardHandler = adminAuditModule.adminAuditDashboardHandler;
    adminAuditJourneyHandler = adminAuditModule.adminAuditJourneyHandler;
    adminAuditNotesHandler = adminAuditModule.adminAuditNotesHandler;
    adminAuditExportHandler = adminAuditModule.adminAuditExportHandler;
    console.log('✅ Audit log handlers loaded');

    console.log('All routes loaded successfully');
  } catch (err) {
    console.error('Error loading routes:', err);
    throw err;
  }
}

// API Routes
app.post('/api/upload', rateLimit('/api/upload'), async (req, res) => {
  if (!uploadHandler) {
    return res.status(500).json({ error: 'Upload handler not loaded' });
  }
  return uploadHandler(req, res);
});

app.post('/api/transcribe', rateLimit('/api/transcribe'), async (req, res) => {
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

app.post('/api/youtube', rateLimit('/api/youtube'), async (req, res) => {
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
app.post('/api/youtube-download', rateLimit('/api/youtube-download'), async (req, res) => {
  if (!youtubeDownloadHandler) {
    return res.status(500).json({ error: 'YouTube Download handler not loaded' });
  }
  return youtubeDownloadHandler(req, res);
});

app.post('/api/youtube-formats', rateLimit('/api/youtube-formats'), async (req, res) => {
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

app.all('/api/export-video', rateLimit('/api/export-video'), async (req, res) => {
  if (!exportVideoHandler) {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Video export is not available on this server.'
    });
  }
  return exportVideoHandler(req, res);
});

app.post('/api/subscription', async (req, res) => {
  if (!subscriptionHandler) {
    return res.status(500).json({ error: 'Subscription handler not loaded' });
  }
  return subscriptionHandler(req, res);
});

app.get('/api/projects', async (req, res) => {
  if (!projectsHandler) {
    return res.status(503).json({ error: 'Projects handler not loaded' });
  }
  return projectsHandler(req, res);
});

app.post('/api/projects', async (req, res) => {
  if (!projectsHandler) {
    return res.status(503).json({ error: 'Projects handler not loaded' });
  }
  return projectsHandler(req, res);
});

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  if (!stripeCheckoutHandler) {
    return res.status(503).json({ error: 'Stripe checkout not loaded' });
  }
  return stripeCheckoutHandler(req, res);
});

app.post('/api/stripe/portal', async (req, res) => {
  if (!stripePortalHandler) {
    return res.status(503).json({ error: 'Stripe portal not loaded' });
  }
  return stripePortalHandler(req, res);
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

app.post('/api/payment/callback', async (req, res) => {
  if (!paymentCallbackHandler) {
    return res.status(503).json({ error: 'Payment callback not loaded' });
  }
  return paymentCallbackHandler(req, res);
});
app.get('/api/payment/callback', async (req, res) => {
  if (!paymentCallbackHandler) {
    return res.status(503).json({ error: 'Payment callback not loaded' });
  }
  return paymentCallbackHandler(req, res);
});
app.post('/api/payment/retry', async (req, res) => {
  if (!paymentRetryHandler) {
    return res.status(503).json({ error: 'Payment retry not loaded' });
  }
  return paymentRetryHandler(req, res);
});

app.get('/api/invoices', async (req, res) => {
  if (!invoicesHandler) {
    return res.status(503).json({ error: 'Invoices not loaded' });
  }
  return invoicesHandler(req, res);
});
app.get('/api/invoices/:id', async (req, res) => {
  if (!invoiceByIdHandler) {
    return res.status(503).json({ error: 'Invoice by id not loaded' });
  }
  return invoiceByIdHandler(req, res);
});

app.post('/api/analytics', async (req, res) => {
  if (!analyticsHandler) {
    return res.status(503).json({ ok: false });
  }
  return analyticsHandler(req, res);
});

app.post('/api/audit/event', async (req, res) => {
  if (!auditEventHandler) {
    return res.status(503).json({ ok: false, error: 'not_loaded' });
  }
  return auditEventHandler(req, res);
});

app.post('/api/leads', async (req, res) => {
  if (!leadsHandler) {
    return res.status(503).json({ ok: false });
  }
  return leadsHandler(req, res);
});

app.get('/api/creator-wall', async (req, res) => {
  if (!creatorWallHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return creatorWallHandler(req, res);
});
app.post('/api/creator-wall', async (req, res) => {
  if (!creatorWallHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return creatorWallHandler(req, res);
});

app.get('/api/admin/creator-wall', async (req, res) => {
  if (!adminCreatorWallHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return adminCreatorWallHandler(req, res);
});
app.post('/api/admin/creator-wall', async (req, res) => {
  if (!adminCreatorWallHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return adminCreatorWallHandler(req, res);
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

app.post('/api/account/logout-other-sessions', async (req, res) => {
  if (!accountSecurityHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return accountSecurityHandler(req, res);
});

app.post('/api/account/request-deletion', async (req, res) => {
  if (!accountSecurityHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return accountSecurityHandler(req, res);
});

app.get('/api/account/delete-confirm', async (req, res) => {
  if (!accountSecurityHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return accountSecurityHandler(req, res);
});

app.post('/api/account/delete-confirm', async (req, res) => {
  if (!accountSecurityHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return accountSecurityHandler(req, res);
});

app.get('/api/account/login-blocked', async (req, res) => {
  if (!accountSecurityHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  req._accountAction = 'login-blocked';
  return accountSecurityHandler(req, res);
});

app.get('/api/offers', async (req, res) => {
  if (!offersHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return offersHandler(req, res);
});
app.post('/api/offers/validate', async (req, res) => {
  if (!offersHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return offersHandler(req, res);
});
app.get('/api/admin/offers', async (req, res) => {
  if (!adminOffersHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return adminOffersHandler(req, res);
});
app.post('/api/admin/offers', async (req, res) => {
  if (!adminOffersHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return adminOffersHandler(req, res);
});
app.get('/api/admin-offers', async (req, res) => {
  if (!adminOffersHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return adminOffersHandler(req, res);
});
app.post('/api/admin-offers', async (req, res) => {
  if (!adminOffersHandler) return res.status(503).json({ ok: false, error: 'not_loaded' });
  return adminOffersHandler(req, res);
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

app.post('/api/admin/cms/media', async (req, res) => {
  if (!adminCmsMediaHandler) {
    return res.status(503).json({ error: 'CMS media handler not loaded' });
  }
  return adminCmsMediaHandler(req, res);
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

app.get('/api/admin/ops/state', async (req, res) => {
  if (!adminOpsStateHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminOpsStateHandler(req, res);
});

app.get('/api/admin/providers', async (req, res) => {
  if (!adminProvidersHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminProvidersHandler(req, res);
});

app.get('/api/admin/audit/dashboard', async (req, res) => {
  if (!adminAuditDashboardHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditDashboardHandler(req, res);
});

app.get('/api/admin/audit/journey', async (req, res) => {
  if (!adminAuditJourneyHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditJourneyHandler(req, res);
});

app.get('/api/admin/audit/export', async (req, res) => {
  if (!adminAuditExportHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditExportHandler(req, res);
});

app.get('/api/admin/audit/events/:eventId/notes', async (req, res) => {
  if (!adminAuditNotesHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditNotesHandler(req, res);
});

app.post('/api/admin/audit/events/:eventId/notes', async (req, res) => {
  if (!adminAuditNotesHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditNotesHandler(req, res);
});

app.get('/api/admin/audit/summary', async (req, res) => {
  if (!adminAuditSummaryHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditSummaryHandler(req, res);
});

app.get('/api/admin/audit/user/:userId', async (req, res) => {
  if (!adminAuditUserTimelineHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditUserTimelineHandler(req, res);
});

app.get('/api/admin/audit', async (req, res) => {
  if (!adminAuditListHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditListHandler(req, res);
});

app.get('/api/admin/audit/charts', async (req, res) => {
  if (!adminAuditChartsHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditChartsHandler(req, res);
});

app.get('/api/admin/audit/funnel', async (req, res) => {
  if (!adminAuditFunnelHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditFunnelHandler(req, res);
});

app.get('/api/admin/audit/alerts', async (req, res) => {
  if (!adminAuditAlertsHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditAlertsHandler(req, res);
});

app.post('/api/admin/audit/evaluate-alerts', async (req, res) => {
  if (!adminAuditEvaluateAlertsHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditEvaluateAlertsHandler(req, res);
});

app.post('/api/admin/audit/seed', async (req, res) => {
  if (!adminAuditSeedHandler) {
    return res.status(503).json({ error: 'not_loaded' });
  }
  return adminAuditSeedHandler(req, res);
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

app.get(['/admin/ops', '/admin/command-center'], (_req, res) => {
  res.redirect(302, '/adminha.html?section=ops');
});

// Dashboard/checkout: never serve stale copies from browser or reverse-proxy caches.
app.use((req, res, next) => {
  const p = req.path || '';
  if (
    /^\/dashboard\.(html|js|css)$/.test(p) ||
    /^\/checkout\.(html|js|css)$/.test(p) ||
    /^\/login\.html$/.test(p) ||
    p === '/plan-checkout-router.js' ||
    p === '/login.js'
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Cutup-Asset-Policy', 'no-store');
  }
  next();
});

// --- Blog: /blog/{slug} → blog/{slug}.html (static files) + list API ---
const BLOG_404 = join(__dirname, 'website', '404.html');
/** Published posts: {repo}/blog/{slug}.html — same path on server as /var/www/cutup/blog/ */
const BLOG_STATIC_DIR = join(__dirname, 'blog');

function normalizeBlogSlug(raw) {
  let slug = String(raw || '').trim();
  if (!slug) return '';
  if (slug.toLowerCase().endsWith('.html')) slug = slug.slice(0, -5);
  if (!slug || slug.includes('/') || slug.includes('.')) return '';
  return slug;
}

app.get('/blog.html', (req, res, next) => {
  const slug = req.query?.slug;
  if (slug && String(slug).trim()) {
    return res.redirect(301, `/blog/${encodeURIComponent(String(slug).trim())}`);
  }
  return next();
});

app.get('/blog-ai-subtitle-generators-2026.html', (_req, res) => {
  res.redirect(301, '/blog/best-ai-subtitle-generators-2026');
});

app.get('/api/blog/posts', async (req, res) => {
  const { listBlogPostsHandler } = await import('./api/blog-public.js');
  return listBlogPostsHandler(req, res);
});

app.get('/api/blog/posts/:slug', async (req, res) => {
  const { getBlogPostHandler } = await import('./api/blog-public.js');
  return getBlogPostHandler(req, res);
});

async function serveBlogPostBySlug(req, res) {
  const slug = normalizeBlogSlug(req.params.slug);
  if (!slug) return res.status(404).sendFile(BLOG_404);

  const staticPath = join(BLOG_STATIC_DIR, `${slug}.html`);
  if (existsSync(staticPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.sendFile(staticPath);
  }

  try {
    const { getStaticBlogArticle } = await import('./api/blog-static-registry.js');
    const { renderBlogPostPage } = await import('./api/blog-ssr.js');
    const { writeBlogHtmlFile } = await import('./api/blog-files.js');
    const article = getStaticBlogArticle(slug);
    if (article && article.status === 'published') {
      const html = renderBlogPostPage(article);
      if (html) {
        writeBlogHtmlFile(slug, html);
        console.warn('[blog] recovery: materialized', slug, 'from blog-pages');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
        return res.status(200).send(html);
      }
    }
  } catch (err) {
    console.error('[blog] recovery render failed:', slug, err?.message);
  }

  return res.status(404).sendFile(BLOG_404);
}

app.get('/blog/:slug', serveBlogPostBySlug);
app.get('/blog/:slug.html', serveBlogPostBySlug);

app.use((req, res, next) => {
  if (req.path.startsWith('/blog-pages/') || req.path.startsWith('/_deprecated/')) {
    return res.status(404).sendFile(BLOG_404);
  }
  return next();
});

// Static site (HTML, assets) — after API routes so /api/* is not shadowed.
app.use((req, _res, next) => {
  if (
    req.path === '/sw.js' ||
    req.path === '/manifest.json' ||
    req.path.startsWith('/icons/') ||
    req.path.endsWith('.json') ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.css')
  ) {
    console.log('Serving static:', req.path);
  }
  next();
});

// public MUST come before website (PWA/static precedence)
app.use(
  express.static(join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.json')) {
        res.type('application/json; charset=utf-8');
      } else if (filePath.endsWith('.js')) {
        res.type('application/javascript; charset=utf-8');
      }
    }
  })
);
app.use(
  express.static(join(__dirname, 'website'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.json')) {
        res.type('application/json; charset=utf-8');
      } else if (filePath.endsWith('.js')) {
        res.type('application/javascript; charset=utf-8');
      }
    }
  })
);

// Unknown routes: real HTTP 404 (no redirect to home / index).
app.use((req, res) => {
  const apiPath = req.path || '';
  if (apiPath === '/api' || apiPath.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  return res.status(404).sendFile(join(__dirname, 'website', '404.html'));
});

// Error handler — must be after routes + 404; only runs for thrown errors / next(err).
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server
loadRoutes().then(async () => {
  const server = createServer(app);
  try {
    const { attachAuditLiveWebSocket } = await import('./api/audit-ws-setup.js');
    attachAuditLiveWebSocket(server);
  } catch (e) {
    console.warn('[audit] WebSocket live feed not attached:', e?.message || e);
  }

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
    console.log(`   POST /api/stripe/portal`);
    console.log(`   GET  /api/subscription?action=billing`);
    console.log(`   POST /api/payment/create`);
    console.log(`   POST /api/payment/verify`);
    console.log(`   POST /api/payment/callback`);
    console.log(`   POST /api/payment/retry`);
    console.log(`   GET  /api/invoices`);
    console.log(`   GET  /api/invoices/:id`);
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

