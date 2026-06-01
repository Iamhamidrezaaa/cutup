/**
 * Content domain detection from transcript, title, and description.
 * Keyword + vocabulary signals (no rendering/timing impact).
 */

export const SUPPORTED_DOMAINS = [
  'fitness',
  'business',
  'marketing',
  'sales',
  'programming',
  'technology',
  'real_estate',
  'finance',
  'education',
  'general'
];

/** @type {Record<string, { keywords: string[], phrases?: string[], weight?: number }>} */
const DOMAIN_SIGNALS = {
  fitness: {
    weight: 1.15,
    keywords: [
      'deadlift',
      'squat',
      'bench',
      'protein',
      'rep',
      'reps',
      'set',
      'sets',
      'gym',
      'workout',
      'cardio',
      'hypertrophy',
      'macros',
      'calories',
      'bulk',
      'cut',
      'pr',
      'personal record',
      'barbell',
      'dumbbell',
      'leg day',
      'pull-up',
      'dead lift',
      'spotter',
      'warm-up',
      'cooldown',
      'muscle',
      'lifting',
      'trainer',
      'fitness',
      'bodybuilding',
      'crossfit',
      'recovery',
      'stretch'
    ],
    phrases: ['nice deadlift', 'keep your core', 'one more rep']
  },
  sales: {
    weight: 1.1,
    keywords: [
      'lead',
      'leads',
      'offer',
      'closing',
      'close',
      'conversion',
      'prospect',
      'pipeline',
      'objection',
      'commission',
      'quota',
      'cold call',
      'discovery call',
      'demo',
      'proposal',
      'deal',
      'upsell',
      'cross-sell',
      'negotiation',
      'follow-up',
      'crm',
      'sales call',
      'buyer',
      'seller'
    ],
    phrases: ['close the deal', 'book a call', 'sales funnel']
  },
  marketing: {
    weight: 1.1,
    keywords: [
      'ctr',
      'roas',
      'campaign',
      'ad',
      'ads',
      'creative',
      'copy',
      'hook',
      'funnel',
      'landing page',
      'cpc',
      'cpm',
      'impressions',
      'reach',
      'engagement',
      'brand',
      'audience',
      'targeting',
      'retargeting',
      'pixel',
      'utm',
      'influencer',
      'viral',
      'content strategy',
      'seo',
      'sem',
      'growth hack'
    ],
    phrases: ['ad spend', 'marketing campaign', 'click through']
  },
  business: {
    weight: 1.0,
    keywords: [
      'startup',
      'founder',
      'ceo',
      'revenue',
      'profit',
      'margin',
      'burn rate',
      'runway',
      'mvp',
      'pivot',
      'scale',
      'scaling',
      'team',
      'hire',
      'hiring',
      'investor',
      'fundraising',
      'valuation',
      'equity',
      'board',
      'strategy',
      'operations',
      'kpi',
      'okr',
      'b2b',
      'b2c',
      'saas',
      'entrepreneur',
      'cash flow'
    ],
    phrases: ['build a business', 'grow the company']
  },
  programming: {
    weight: 1.12,
    keywords: [
      'api',
      'repository',
      'repo',
      'deployment',
      'deploy',
      'git',
      'github',
      'commit',
      'pull request',
      'merge',
      'typescript',
      'javascript',
      'python',
      'function',
      'class',
      'variable',
      'debug',
      'stack trace',
      'compiler',
      'runtime',
      'docker',
      'kubernetes',
      'ci',
      'cd',
      'backend',
      'frontend',
      'database',
      'sql',
      'nosql',
      'refactor',
      'unit test',
      'integration test',
      'code review'
    ],
    phrases: ['pull request', 'code base', 'rest api']
  },
  technology: {
    weight: 1.05,
    keywords: [
      'ai',
      'machine learning',
      'llm',
      'gpu',
      'cloud',
      'server',
      'latency',
      'bandwidth',
      'encryption',
      'security',
      'software',
      'hardware',
      'chip',
      'processor',
      'infrastructure',
      'platform',
      'integration',
      'automation',
      'workflow',
      'feature',
      'release',
      'beta',
      'saas',
      'subscription',
      'app',
      'mobile',
      'ios',
      'android'
    ],
    phrases: ['artificial intelligence', 'tech stack']
  },
  real_estate: {
    weight: 1.08,
    keywords: [
      'mortgage',
      'listing',
      'property',
      'rent',
      'rental',
      'landlord',
      'tenant',
      'lease',
      'down payment',
      'closing costs',
      'appraisal',
      'equity',
      'refinance',
      'hoa',
      'square feet',
      'sqft',
      'bedroom',
      'bathroom',
      'zoning',
      'flip',
      'realtor',
      'broker',
      'open house',
      'cap rate',
      'cash flow property',
      'airbnb'
    ],
    phrases: ['real estate', 'investment property']
  },
  finance: {
    weight: 1.08,
    keywords: [
      'stock',
      'bond',
      'portfolio',
      'dividend',
      'interest rate',
      'inflation',
      'etf',
      'mutual fund',
      'hedge',
      'options',
      'futures',
      'forex',
      'crypto',
      'bitcoin',
      'ethereum',
      'trading',
      'invest',
      'investment',
      'asset',
      'liability',
      'balance sheet',
      'p/e',
      'market cap',
      'compound',
      'savings',
      'retirement',
      '401k',
      'ira'
    ],
    phrases: ['stock market', 'financial freedom']
  },
  education: {
    weight: 1.05,
    keywords: [
      'student',
      'teacher',
      'professor',
      'course',
      'lesson',
      'curriculum',
      'exam',
      'test',
      'homework',
      'study',
      'university',
      'college',
      'degree',
      'lecture',
      'tutorial',
      'learning',
      'education',
      'classroom',
      'assignment',
      'grade',
      'scholarship',
      'thesis',
      'research paper',
      'online course',
      'certification'
    ],
    phrases: ['study guide', 'pass the exam']
  }
};

function tokenizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+#+]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countKeywordHits(corpus, keywords) {
  const t = tokenizeForMatch(corpus);
  const hits = [];
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(t) || t.includes(k)) {
      hits.push(kw);
      score += 1;
    }
  }
  return { score, hits };
}

function scoreDomain(domain, corpus, titleBoost, descBoost) {
  const spec = DOMAIN_SIGNALS[domain];
  if (!spec) return { score: 0, matchedSignals: [] };

  const kw = countKeywordHits(corpus, spec.keywords || []);
  let score = kw.score * (spec.weight || 1);
  const matchedSignals = [...kw.hits];

  for (const phrase of spec.phrases || []) {
    if (tokenizeForMatch(corpus).includes(phrase.toLowerCase())) {
      score += 2;
      matchedSignals.push(`phrase:${phrase}`);
    }
  }

  if (titleBoost > 0) {
    const titleHits = countKeywordHits(titleBoost, spec.keywords || []);
    score += titleHits.score * 1.8;
    matchedSignals.push(...titleHits.hits.map((h) => `title:${h}`));
  }

  if (descBoost > 0) {
    const descHits = countKeywordHits(descBoost, spec.keywords || []);
    score += descHits.score * 1.4;
    matchedSignals.push(...descHits.hits.map((h) => `desc:${h}`));
  }

  return { score, matchedSignals: [...new Set(matchedSignals)].slice(0, 24) };
}

/**
 * @param {object} input
 * @param {string} [input.transcript]
 * @param {string} [input.title]
 * @param {string} [input.description]
 * @param {{ text: string }[]} [input.segments]
 */
export function detectContentDomain(input = {}) {
  const parts = [];
  if (Array.isArray(input.segments) && input.segments.length) {
    parts.push(input.segments.map((s) => s?.text || '').join(' '));
  }
  if (input.transcript) parts.push(String(input.transcript));
  const transcript = parts.join(' ').trim();
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const corpus = [transcript, title, description].filter(Boolean).join('\n');

  if (!corpus.trim()) {
    return {
      domain: 'general',
      confidence: 0.4,
      matchedSignals: [],
      scores: {}
    };
  }

  const ranked = [];
  const scores = {};
  const allSignals = {};

  for (const domain of Object.keys(DOMAIN_SIGNALS)) {
    const { score, matchedSignals } = scoreDomain(domain, transcript, title, description);
    scores[domain] = Number(score.toFixed(2));
    allSignals[domain] = matchedSignals;
    if (score > 0) ranked.push({ domain, score, matchedSignals });
  }

  ranked.sort((a, b) => b.score - a.score);

  let domain = 'general';
  let confidence = 0.45;
  let matchedSignals = [];

  if (ranked.length > 0 && ranked[0].score >= 1.5) {
    domain = ranked[0].domain;
    const top = ranked[0].score;
    const second = ranked[1]?.score || 0;
    confidence = Math.min(0.98, Math.max(0.55, top / (top + second + 2)));
    matchedSignals = ranked[0].matchedSignals;
  } else if (ranked.length > 0 && ranked[0].score >= 0.5) {
    domain = ranked[0].domain;
    confidence = Math.min(0.75, 0.45 + ranked[0].score * 0.08);
    matchedSignals = ranked[0].matchedSignals;
  }

  return {
    domain,
    confidence: Number(confidence.toFixed(2)),
    matchedSignals,
    scores,
    transcriptLength: transcript.length
  };
}

/**
 * @param {string} traceId
 * @param {ReturnType<typeof detectContentDomain>} result
 */
export function logDomainDetection(traceId, result) {
  console.log(
    '[domain-detection]',
    JSON.stringify({
      traceId,
      domain: result.domain,
      confidence: result.confidence,
      matchedSignals: result.matchedSignals,
      topScores: result.scores
        ? Object.entries(result.scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([d, s]) => ({ domain: d, score: s }))
        : undefined
    })
  );
}
