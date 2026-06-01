import {
  getRewriteStrategy,
  buildLanguageAwareRewritePrompts,
  SUPPORTED_REWRITE_LANGUAGES
} from './translation-rewrite-strategies.js';

for (const lang of ['fa', 'ar', 'es']) {
  const s = getRewriteStrategy(lang);
  const p = buildLanguageAwareRewritePrompts('Nice deadlift', 'ددلیفت خوبی است', lang);
  console.log(lang, s.id, p.systemPrompt.slice(0, 60) + '...');
}

console.log('supported', SUPPORTED_REWRITE_LANGUAGES.length);
console.log('ok');
