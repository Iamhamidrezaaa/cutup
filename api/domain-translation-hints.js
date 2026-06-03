/**
 * Domain-aware localization hints for translation / rewrite prompts.
 */

import { SUPPORTED_DOMAINS } from './domain-detection.js';

function normDomain(d) {
  const x = String(d || 'general')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
  return SUPPORTED_DOMAINS.includes(x) ? x : 'general';
}

function normLang(code) {
  return String(code || '')
    .toLowerCase()
    .slice(0, 2);
}

/** Per domain × target language few-shot tone rules. */
const DOMAIN_LOCALIZATION = {
  fitness: {
    fa: [
      'Fitness praise must sound spoken and gym-native, not textbook Persian.',
      'Keep loanwords only when the source mentions them (ددلیفت، اسکوات، بنچ).',
      'Short energetic cues; coach tone.'
    ],
    ar: ['Use natural gym Arabic; praise should feel spoken, not textbook.'],
    es: ['Use gym Spanish: peso muerto, sentadilla; energetic tone.'],
    en: ['Fitness coach tone; natural praise for lifts and form.']
  },
  sales: {
    fa: ['Sales tone: direct, confident, startup Persian; "lead", "offer", "close" naturally.'],
    ar: ['Persuasive sales Arabic; avoid bureaucratic phrasing.'],
    es: ['Sales Spanish: cierre, propuesta, cliente; confident tone.']
  },
  marketing: {
    fa: ['Marketing: hooks, campaigns, CTR/ROAS in natural Persian creator speak.'],
    es: ['Marketing Spanish: campaña, anuncio, embudo; creator tone.']
  },
  business: {
    fa: ['Startup/business Persian; revenue, MVP, fundraising — not formal news Persian.'],
    ar: ['Business Arabic: startup tone, not government/formal.'],
    es: ['Entrepreneurship Spanish; avoid overly literal English.']
  },
  programming: {
    fa: ['Tech/dev Persian: API، deploy، repository — keep common dev loanwords.'],
    en: ['Developer subtitle tone; keep API, repo, deploy terms clear.']
  },
  technology: {
    fa: ['Tech product Persian; AI/GPU/cloud terms as used in Persian tech YouTube.'],
    en: ['Clear tech explainer tone.']
  },
  real_estate: {
    fa: ['Real estate Persian: mortgage, rent, listing — natural investor/agent speak.'],
    en: ['Property/investing tone; clear numbers and terms.']
  },
  finance: {
    fa: ['Finance Persian: market, portfolio, invest — creator/investor tone not bank legal.'],
    en: ['Investing/finance educator tone.']
  },
  education: {
    fa: ['Teaching Persian: clear, encouraging, student-friendly.'],
    en: ['Educator tone; explain simply.']
  },
  general: {
    fa: [
      'General conversational Persian; avoid literal word-for-word and formal «خوبی است» patterns.',
      'Never paste style-guide example sentences into subtitles.'
    ],
    ar: ['General modern Arabic subtitles.'],
    es: ['General conversational Spanish.']
  }
};

/**
 * Prompt fragment for translation / rewrite system prompts.
 * @param {string} domain
 * @param {string} targetLanguage
 */
export function getDomainLocalizationRules(domain, targetLanguage) {
  const d = normDomain(domain);
  const lang = normLang(targetLanguage);
  const block = DOMAIN_LOCALIZATION[d] || DOMAIN_LOCALIZATION.general;
  const rules = block[lang] || block.en || block.fa || [];
  if (!rules.length) return '';
  return ` Content domain: ${d}. ${rules.join(' ')}`;
}

/**
 * Short label for prompts.
 */
export function getDomainLabel(domain) {
  return normDomain(domain);
}
