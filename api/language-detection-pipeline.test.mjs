import {
  resolveLanguageFromTranscript,
  inferAccentProfile,
  applyEnglishAccentProtection,
  applyLatinScriptGuard,
  majorityLanguageVote
} from './language-detection-pipeline.js';
import { analyzeTranscriptLanguage } from './transcript-language-analysis.js';

const englishText =
  'Nice deadlift bro, I just want to grab a drink with you. Is that important?';
const englishSegments = [
  { text: 'Nice deadlift bro' },
  { text: 'I just want to grab a drink with you' }
];

const accentCase = resolveLanguageFromTranscript('ru', englishText, englishSegments, {
  providerLanguage: 'ru',
  providerConfidence: 0.92
});
console.log('accent pipeline', accentCase.language, accentCase.accent, accentCase.languageConfidence);
if (accentCase.language !== 'en') {
  console.error('FAIL: expected en for Russian-accent English');
  process.exit(1);
}
if (accentCase.accent !== 'russian') {
  console.error('FAIL: expected russian accent');
  process.exit(1);
}

const analysis = analyzeTranscriptLanguage(englishText, englishSegments);
const accentProfile = inferAccentProfile('ru', 'en', analysis);
if (accentProfile.accent !== 'russian') {
  console.error('FAIL: inferAccentProfile expected russian');
  process.exit(1);
}

const protectedLang = applyEnglishAccentProtection('ru', 'ru', analysis);
if (protectedLang !== 'en') {
  console.error('FAIL: applyEnglishAccentProtection expected en');
  process.exit(1);
}

const latinGuard = applyLatinScriptGuard('ru', 0.81, 0.9, analysis);
if (latinGuard.language !== 'en' || !latinGuard.overrideApplied) {
  console.error('FAIL: applyLatinScriptGuard expected en override');
  process.exit(1);
}

const latinGuardHigh = applyLatinScriptGuard('ru', 0.81, 0.96, analysis);
if (latinGuardHigh.overrideApplied) {
  console.error('FAIL: high confidence should not override');
  process.exit(1);
}

const suspiciousLatin = resolveLanguageFromTranscript(
  'ru',
  'Hello everyone this is a test of English speech with many Latin letters.',
  [{ text: 'Hello everyone this is a test' }],
  { providerLanguage: 'ru', providerConfidence: 0.9 }
);
if (suspiciousLatin.language !== 'en') {
  console.error('FAIL: suspicious RTL latin override expected en');
  process.exit(1);
}

const realRussian = resolveLanguageFromTranscript(
  'ru',
  'Привет, как дела? Я хочу поговорить с тобой.',
  [{ text: 'Привет, как дела?' }],
  { providerLanguage: 'ru', providerConfidence: 0.95 }
);
if (realRussian.language !== 'ru') {
  console.error('FAIL: expected ru for real Russian');
  process.exit(1);
}

const vote = majorityLanguageVote([
  { provider: 'openai', position: 'first', language: 'en' },
  { provider: 'openai', position: 'middle', language: 'en' },
  { provider: 'openai', position: 'last', language: 'ru' }
]);
if (vote.language !== 'en' || vote.providerAgreement < 0.6) {
  console.error('FAIL: triple-sample majority vote expected en with ~0.67 agreement');
  process.exit(1);
}

console.log('language-detection-pipeline ok');
