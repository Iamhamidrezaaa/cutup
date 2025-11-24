// API endpoint for managing user subscriptions and usage limits
// This is a simplified in-memory version. In production, use a database.

import { handleCORS, setCORSHeaders } from './cors.js';

// In-memory storage (in production, use database)
const userSubscriptions = new Map();
const userUsage = new Map();

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
      summarization: false, // No summarization for free
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
function getUserUsage(userId) {
  initializeUser(userId);
  return userUsage.get(userId);
}

// Check if user can use feature
function canUseFeature(userId, feature, videoDurationMinutes = 0) {
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
function recordUsage(userId, minutes) {
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
}

// Record download
function recordDownload(userId, type) {
  const usage = getUserUsage(userId);
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  // Reset if new month
  if (usage.downloads[type].month !== currentMonth || usage.downloads[type].year !== currentYear) {
    usage.downloads[type] = { month: currentMonth, year: currentYear, count: 0 };
  }
  
  usage.downloads[type].count += 1;
}

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  const { method, query, body } = req;
  const action = query.action || body?.action;
  const sessionId = req.headers['x-session-id'] || query.session || body?.session;

  try {
    // Get user from session (simplified - in production, verify session properly)
    if (!sessionId) {
      return res.status(401).json({ error: 'No session provided' });
    }

    // In production, verify session and get userId
    // For now, use sessionId as userId (simplified)
    const userId = sessionId; // TODO: Get actual userId from session

    // Get subscription info
    if (method === 'GET' && action === 'info') {
      const subscription = getUserSubscription(userId);
      const usage = getUserUsage(userId);
      const plan = PLANS[subscription.plan];
      
      return res.json({
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
              limit: plan.downloadAudioLimit || null
            },
            video: {
              count: usage.downloads.video.count,
              limit: plan.downloadVideoLimit || null
            }
          }
        },
        subscription: {
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          billingPeriod: subscription.billingPeriod
        }
      });
    }

    // Check if user can use feature
    if (method === 'POST' && action === 'check') {
      const { feature, videoDurationMinutes = 0 } = body;
      
      if (!feature) {
        return res.status(400).json({ error: 'Feature is required' });
      }
      
      const check = canUseFeature(userId, feature, videoDurationMinutes);
      return res.json(check);
    }

    // Record usage
    if (method === 'POST' && action === 'record') {
      const { minutes } = body;
      
      if (!minutes || minutes <= 0) {
        return res.status(400).json({ error: 'Valid minutes is required' });
      }
      
      recordUsage(userId, minutes);
      return res.json({ success: true });
    }

    // Record download
    if (method === 'POST' && action === 'recordDownload') {
      const { type } = body; // 'audio' or 'video'
      
      if (!type || !['audio', 'video'].includes(type)) {
        return res.status(400).json({ error: 'Valid type (audio/video) is required' });
      }
      
      recordDownload(userId, type);
      return res.json({ success: true });
    }

    // Get all plans
    if (method === 'GET' && action === 'plans') {
      return res.json({
        plans: Object.keys(PLANS).map(key => ({
          id: key,
          ...PLANS[key]
        }))
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

