// API endpoint for managing user subscriptions and usage limits
// This is a simplified in-memory version. In production, use a database.

import { handleCORS, setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';

// In-memory storage (in production, use database)
const userSubscriptions = new Map();
const userUsage = new Map();
const userUsageHistory = new Map(); // Store detailed usage history

// Subscription plans
const PLANS = {
  free: {
    name: 'رایگان',
    nameEn: 'Free',
    dailyLimit: 3, // minutes per day
    monthlyLimit: 20, // minutes per month
    downloadAudioLimit: 3, // 3 audio downloads per month
    downloadVideoLimit: 3, // 3 video downloads per month
    features: {
      transcription: true,
      summarization: true, // Unlimited for all tiers
      srt: false, // No SRT for free
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: '480p' // Max quality for video download
    },
    price: {
      monthly: 0,
      quarterly: 0,
      semiannual: 0,
      annual: 0
    }
  },
  starter: {
    name: 'Starter',
    nameEn: 'Starter',
    monthlyLimit: 120, // 2 hours = 120 minutes
    downloadAudioLimit: 20, // 20 audio downloads per month
    downloadVideoLimit: 20, // 20 video downloads per month
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: {
      monthly: 360000, // 360,000 Toman
      quarterly: 972000, // 10% discount
      semiannual: 1836000, // 15% discount
      annual: 3240000 // 25% discount
    }
  },
  pro: {
    name: 'Pro',
    nameEn: 'Pro',
    monthlyLimit: 300, // 5 hours = 300 minutes
    downloadAudioLimit: 100, // 100 audio downloads per month
    downloadVideoLimit: 100, // 100 video downloads per month
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: {
      monthly: 900000, // 900,000 Toman
      quarterly: 2430000, // 10% discount
      semiannual: 4590000, // 15% discount
      annual: 8100000 // 25% discount
    }
  },
  business: {
    name: 'Business',
    nameEn: 'Business',
    monthlyLimit: 600, // 10 hours = 600 minutes
    downloadAudioLimit: null, // Unlimited
    downloadVideoLimit: null, // Unlimited
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: {
      monthly: 1800000, // 1,800,000 Toman
      quarterly: 4860000, // 10% discount
      semiannual: 9180000, // 15% discount
      annual: 16200000 // 25% discount
    }
  }
};

// Initialize user with free plan
function initializeUser(userId) {
  if (!userSubscriptions.has(userId)) {
    userSubscriptions.set(userId, {
      plan: 'free',
      startDate: new Date(),
      endDate: null, // Free plan never expires
      billingPeriod: 'monthly'
    });
    
    userUsage.set(userId, {
      daily: {
        date: new Date().toDateString(),
        minutes: 0
      },
      monthly: {
        month: new Date().getMonth(),
        year: new Date().getFullYear(),
        minutes: 0
      },
      downloads: {
        audio: {
          month: new Date().getMonth(),
          year: new Date().getFullYear(),
          count: 0
        },
        video: {
          month: new Date().getMonth(),
          year: new Date().getFullYear(),
          count: 0
        }
      }
    });
  }
}

// Get user subscription
function getUserSubscription(userId) {
  initializeUser(userId);
  return userSubscriptions.get(userId);
}

// Get user usage
function getUserUsage(userId, sessionId = null) {
  initializeUser(userId);
  const usage = userUsage.get(userId);
  
  // Reset audio downloads for h.asgarizade@gmail.com
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.user && session.user.email === 'h.asgarizade@gmail.com') {
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      // Reset audio downloads count to 0
      if (usage.downloads.audio.month === currentMonth && usage.downloads.audio.year === currentYear) {
        usage.downloads.audio.count = 0;
        console.log(`[getUserUsage] Reset audio downloads for h.asgarizade@gmail.com`);
      }
    }
  }
  
  return usage;
}

// Check if user can use feature
export function canUseFeature(userId, feature, videoDurationMinutes = 0) {
  const subscription = getUserSubscription(userId);
  const usage = getUserUsage(userId);
  const plan = PLANS[subscription.plan];
  
    // Map feature names
    let featureKey = feature;
    if (feature === 'transcription') {
      featureKey = 'transcription';
    } else if (feature === 'summarization') {
      featureKey = 'summarization';
    } else if (feature === 'downloadAudio' || feature === 'downloadVideo') {
      featureKey = feature === 'downloadAudio' ? 'downloadAudio' : 'downloadVideo';
    }
    
    // Check feature availability
    if (!plan.features[featureKey]) {
      return { allowed: false, reason: 'این ویژگی در پلن فعلی شما در دسترس نیست' };
    }
  
  // Check download limits for free plan
  if (subscription.plan === 'free' && (feature === 'downloadAudio' || feature === 'downloadVideo')) {
    const downloadType = feature === 'downloadAudio' ? 'audio' : 'video';
    const downloadLimit = feature === 'downloadAudio' ? plan.downloadAudioLimit : plan.downloadVideoLimit;
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    // Check if we need to reset monthly count
    if (usage.downloads[downloadType].month !== currentMonth || usage.downloads[downloadType].year !== currentYear) {
      usage.downloads[downloadType] = { month: currentMonth, year: currentYear, count: 0 };
    }
    
    if (usage.downloads[downloadType].count >= downloadLimit) {
      return { 
        allowed: false, 
        reason: `حد مجاز دانلود ${downloadType === 'audio' ? 'موزیک' : 'ویدئو'} شما (${downloadLimit} مورد در ماه) تمام شده است. برای دانلود نامحدود، لطفاً پلن خود را ارتقا دهید.`
      };
    }
  }
  
  // For free plan, check daily and monthly limits
  if (subscription.plan === 'free') {
    const today = new Date().toDateString();
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    // Reset daily usage if new day
    if (usage.daily.date !== today) {
      usage.daily = { date: today, minutes: 0 };
    }
    
    // Reset monthly usage if new month
    if (usage.monthly.month !== currentMonth || usage.monthly.year !== currentYear) {
      usage.monthly = { month: currentMonth, year: currentYear, minutes: 0 };
    }
    
    // Check daily limit
    if (usage.daily.minutes + videoDurationMinutes > plan.dailyLimit) {
      return { 
        allowed: false, 
        reason: `حد مجاز روزانه شما (${plan.dailyLimit} دقیقه) تمام شده است` 
      };
    }
    
    // Check monthly limit
    if (usage.monthly.minutes + videoDurationMinutes > plan.monthlyLimit) {
      return { 
        allowed: false, 
        reason: `حد مجاز ماهانه شما (${plan.monthlyLimit} دقیقه) تمام شده است` 
      };
    }
  } else {
    // For paid plans, check monthly limit
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    // Reset monthly usage if new month
    if (usage.monthly.month !== currentMonth || usage.monthly.year !== currentYear) {
      usage.monthly = { month: currentMonth, year: currentYear, minutes: 0 };
    }
    
    // Check if subscription expired
    if (subscription.endDate && new Date() > new Date(subscription.endDate)) {
      return { 
        allowed: false, 
        reason: 'اشتراک شما منقضی شده است. لطفاً پلن خود را تمدید کنید' 
      };
    }
    
    // Check monthly limit
    if (usage.monthly.minutes + videoDurationMinutes > plan.monthlyLimit) {
      return { 
        allowed: false, 
        reason: `حد مجاز ماهانه شما (${plan.monthlyLimit} دقیقه) تمام شده است` 
      };
    }
  }
  
  return { allowed: true };
}

// Record usage
function recordUsage(userId, minutes, type = 'transcription', metadata = {}) {
  const usage = getUserUsage(userId);
  const today = new Date().toDateString();
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  // Update daily usage
  if (usage.daily.date === today) {
    usage.daily.minutes += minutes;
  } else {
    usage.daily = { date: today, minutes };
  }
  
  // Update monthly usage
  if (usage.monthly.month === currentMonth && usage.monthly.year === currentYear) {
    usage.monthly.minutes += minutes;
  } else {
    usage.monthly = { month: currentMonth, year: currentYear, minutes };
  }
  
  // Add to history
  if (!userUsageHistory.has(userId)) {
    userUsageHistory.set(userId, []);
  }
  
  const history = userUsageHistory.get(userId);
  history.push({
    id: Date.now().toString(),
    type: type, // 'transcription', 'summarization', 'downloadAudio', 'downloadVideo'
    minutes: minutes,
    date: new Date().toISOString(),
    metadata: metadata // { title, url, videoId, quality, etc. }
  });
  
  // Keep only last 1000 records per user
  if (history.length > 1000) {
    history.shift();
  }
}

// Record download
export function recordDownload(userId, type, metadata = {}, sessionId = null) {
  // Get usage with reset logic for h.asgarizade@gmail.com
  const usage = getUserUsage(userId, sessionId);
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  // Reset if new month
  if (usage.downloads[type].month !== currentMonth || usage.downloads[type].year !== currentYear) {
    usage.downloads[type] = { month: currentMonth, year: currentYear, count: 0 };
  }
  
  // For h.asgarizade@gmail.com, reset audio downloads to 0 before incrementing
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.user && session.user.email === 'h.asgarizade@gmail.com' && type === 'audio') {
      usage.downloads.audio.count = 0;
      console.log(`[recordDownload] Reset audio downloads for h.asgarizade@gmail.com before recording`);
    }
  }
  
  const oldCount = usage.downloads[type].count;
  usage.downloads[type].count += 1;
  
  console.log(`[recordDownload] userId: ${userId}, type: ${type}, count: ${oldCount} -> ${usage.downloads[type].count}`);
  
  // Add to history
  if (!userUsageHistory.has(userId)) {
    userUsageHistory.set(userId, []);
  }
  
  const history = userUsageHistory.get(userId);
  history.push({
    id: Date.now().toString(),
    type: type === 'audio' ? 'downloadAudio' : 'downloadVideo',
    minutes: 0, // Downloads don't count as minutes
    date: new Date().toISOString(),
    metadata: metadata // { title, url, videoId, quality, etc. }
  });
  
  // Keep only last 1000 records per user
  if (history.length > 1000) {
    history.shift();
  }
}

export default async function handler(req, res) {
  // Handle CORS
  setCORSHeaders(res);

  const { method, query } = req;
  
  // Parse body properly - handle both parsed and string body
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.warn('Failed to parse body as JSON, using as-is:', e.message);
    }
  }
  if (!body) {
    body = {};
  }
  
  const action = query.action || body?.action;
  const sessionId = req.headers['x-session-id'] || query.session || body?.session;

  try {
    // Get all plans (doesn't require session)
    if (method === 'GET' && action === 'plans') {
      return res.json({
        plans: Object.keys(PLANS).map(key => ({
          id: key,
          ...PLANS[key]
        }))
      });
    }

    // Get user from session - use email as userId (consistent across all endpoints)
    if (!sessionId) {
      return res.status(401).json({ error: 'No session provided' });
    }

    // Verify session and get userId from email (consistent with auth system)
    const session = sessions.get(sessionId);
    if (!session || !session.user || !session.user.email) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    // Check if session expired
    if (session.expiresAt && Date.now() > session.expiresAt) {
      sessions.delete(sessionId);
      return res.status(401).json({ error: 'Session expired' });
    }
    
    // Use email as userId (consistent across all endpoints)
    const userId = session.user.email;

    // Get subscription info
    if (method === 'GET' && action === 'info') {
      const subscription = getUserSubscription(userId);
      const usage = getUserUsage(userId, sessionId);
      const plan = PLANS[subscription.plan];
      
      const responseData = {
        plan: subscription.plan,
        planName: plan.name,
        planNameEn: plan.nameEn,
        features: plan.features,
        usage: {
          daily: usage.daily,
          monthly: usage.monthly,
          dailyLimit: plan.dailyLimit || null,
          monthlyLimit: plan.monthlyLimit,
          downloads: {
            audio: {
              count: usage.downloads.audio.count,
              limit: plan.downloadAudioLimit !== undefined ? plan.downloadAudioLimit : null
            },
            video: {
              count: usage.downloads.video.count,
              limit: plan.downloadVideoLimit !== undefined ? plan.downloadVideoLimit : null
            }
          }
        },
        subscription: {
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          billingPeriod: subscription.billingPeriod
        }
      };
      
      console.log(`[action=info] userId: ${userId}, usage:`, JSON.stringify(responseData.usage.downloads));
      
      return res.json(responseData);
    }

    // Check if user can use feature
    if (method === 'POST' && action === 'check') {
      // Parse body - handle all cases
      let requestBody = body;
      if (typeof body === 'string') {
        if (body.length > 0) {
          try {
            requestBody = JSON.parse(body);
          } catch (e) {
            console.warn('Failed to parse body in check action:', e.message, 'Body:', body.substring(0, 100));
            requestBody = {};
          }
        } else {
          requestBody = {};
        }
      }
      if (!requestBody || typeof requestBody !== 'object') {
        requestBody = {};
      }
      
      const { feature, videoDurationMinutes = 0 } = requestBody;
      
      // If no feature provided, return basic usage info (don't fail)
      if (!feature) {
        const usage = getUserUsage(userId, sessionId);
        const subscription = getUserSubscription(userId);
        const plan = PLANS[subscription.plan];
        
        return res.json({
          allowed: true,
          usage: {
            daily: usage.daily,
            monthly: usage.monthly,
            downloads: {
              audio: {
                count: usage.downloads.audio.count,
                limit: plan.downloadAudioLimit !== undefined ? plan.downloadAudioLimit : null
              },
              video: {
                count: usage.downloads.video.count,
                limit: plan.downloadVideoLimit !== undefined ? plan.downloadVideoLimit : null
              }
            }
          }
        });
      }
      
      const check = canUseFeature(userId, feature, videoDurationMinutes);
      return res.json(check);
    }

    // Record usage
    if (method === 'POST' && action === 'record') {
      // Parse body if it's a string
      let requestBody = body;
      if (typeof body === 'string') {
        try {
          requestBody = JSON.parse(body);
        } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON in request body' });
        }
      }
      
      const { minutes, type = 'transcription', metadata = {} } = requestBody || {};
      
      if (!minutes || minutes <= 0) {
        return res.status(400).json({ error: 'Valid minutes is required' });
      }
      
      recordUsage(userId, minutes, type, metadata);
      
      // Return updated usage
      const usage = getUserUsage(userId, sessionId);
      const subscription = getUserSubscription(userId);
      const plan = PLANS[subscription.plan];
      
      return res.json({ 
        success: true,
        usage: {
          daily: usage.daily,
          monthly: usage.monthly,
          dailyLimit: plan.dailyLimit || null,
          monthlyLimit: plan.monthlyLimit,
          downloads: {
            audio: {
              count: usage.downloads.audio.count,
              limit: plan.downloadAudioLimit !== undefined ? plan.downloadAudioLimit : null
            },
            video: {
              count: usage.downloads.video.count,
              limit: plan.downloadVideoLimit !== undefined ? plan.downloadVideoLimit : null
            }
          }
        }
      });
    }

    // Record download
    if (method === 'POST' && action === 'recordDownload') {
      // Parse body - handle all cases
      let requestBody = body;
      if (typeof body === 'string') {
        if (body.length > 0) {
          try {
            requestBody = JSON.parse(body);
          } catch (e) {
            console.error('Failed to parse body in recordDownload action:', e.message, 'Body:', body.substring(0, 100));
            return res.status(400).json({ error: 'Invalid JSON in request body' });
          }
        } else {
          requestBody = {};
        }
      }
      if (!requestBody || typeof requestBody !== 'object') {
        requestBody = {};
      }
      
      const { type, metadata = {} } = requestBody; // 'audio' or 'video'
      
      if (!type || !['audio', 'video'].includes(type)) {
        return res.status(400).json({ error: 'Valid type (audio/video) is required' });
      }
      
      recordDownload(userId, type, metadata, sessionId);
      
      // Return updated usage (with reset logic applied)
      const usage = getUserUsage(userId, sessionId);
      const subscription = getUserSubscription(userId);
      const plan = PLANS[subscription.plan];
      
      const responseData = { 
        success: true,
        usage: {
          daily: usage.daily,
          monthly: usage.monthly,
          dailyLimit: plan.dailyLimit || null,
          monthlyLimit: plan.monthlyLimit,
          downloads: {
            audio: {
              count: usage.downloads.audio.count,
              limit: plan.downloadAudioLimit !== undefined ? plan.downloadAudioLimit : null
            },
            video: {
              count: usage.downloads.video.count,
              limit: plan.downloadVideoLimit !== undefined ? plan.downloadVideoLimit : null
            }
          }
        }
      };
      
      console.log(`[recordDownload response] userId: ${userId}, usage:`, JSON.stringify(responseData.usage.downloads));
      
      return res.json(responseData);
    }

    // Get usage history
    if (method === 'GET' && action === 'history') {
      const history = userUsageHistory.get(userId) || [];
      
      // Sort by date (newest first)
      const sortedHistory = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
      
      // Get limit from query (default 100)
      const limit = parseInt(query.limit) || 100;
      const limitedHistory = sortedHistory.slice(0, limit);
      
      return res.json({
        history: limitedHistory,
        total: history.length
      });
    }

    // Reset audio downloads for h.asgarizade@gmail.com (admin action)
    if (method === 'POST' && action === 'resetAudioDownloads') {
      const session = sessions.get(sessionId);
      if (!session || !session.user || session.user.email !== 'h.asgarizade@gmail.com') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      const usage = getUserUsage(userId, sessionId);
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      // Reset audio downloads
      usage.downloads.audio = { month: currentMonth, year: currentYear, count: 0 };
      
      console.log(`[resetAudioDownloads] Reset audio downloads for h.asgarizade@gmail.com`);
      
      return res.json({ 
        success: true,
        message: 'Audio downloads reset successfully',
        usage: {
          downloads: {
            audio: {
              count: 0,
              limit: PLANS[getUserSubscription(userId).plan].downloadAudioLimit
            }
          }
        }
      });
    }

    // Upgrade subscription (simplified - in production, integrate with payment gateway)
    if (method === 'POST' && action === 'upgrade') {
      const { plan, billingPeriod = 'monthly' } = body;
      
      if (!PLANS[plan]) {
        return res.status(400).json({ error: 'Invalid plan' });
      }
      
      const subscription = getUserSubscription(userId);
      subscription.plan = plan;
      subscription.billingPeriod = billingPeriod;
      subscription.startDate = new Date();
      
      // Calculate end date based on billing period
      const endDate = new Date();
      if (billingPeriod === 'quarterly') {
        endDate.setMonth(endDate.getMonth() + 3);
      } else if (billingPeriod === 'semiannual') {
        endDate.setMonth(endDate.getMonth() + 6);
      } else if (billingPeriod === 'annual') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }
      
      subscription.endDate = endDate;
      
      return res.json({ success: true, subscription });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Subscription error:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'Subscription error',
      message: error.message
    });
  }
}

