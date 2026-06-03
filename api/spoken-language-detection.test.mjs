import { analyzeTranscriptLanguage, resolveSpokenLanguage } from './spoken-language-detection.js';

const englishAccentRussianWhisper = resolveSpokenLanguage(
  'ru',
  'Nice deadlift bro, I just want to grab a drink with you. Is that important?',
  [{ text: 'Nice deadlift bro' }, { text: 'I just want to grab a drink with you' }]
);
console.log('accent case', englishAccentRussianWhisper.detectedLanguage, englishAccentRussianWhisper.resolution);
if (englishAccentRussianWhisper.detectedLanguage !== 'en') {
  console.error('FAIL: expected en');
  process.exit(1);
}

const realRussian = resolveSpokenLanguage(
  'ru',
  'Привет, как дела? Я хочу поговорить с тобой.',
  [{ text: 'Привет, как дела?' }]
);
console.log('real ru', realRussian.detectedLanguage);
if (realRussian.detectedLanguage !== 'ru') {
  console.error('FAIL: expected ru');
  process.exit(1);
}

const analysis = analyzeTranscriptLanguage('Hello world this is a test');
console.log('analysis top', analysis.top, analysis.latinRatio);
if (analysis.top !== 'en') {
  console.error('FAIL: expected en for English sample');
  process.exit(1);
}

const french = resolveSpokenLanguage(
  'en',
  'Tout le monde il est candidat mais personne ne le sait encore pour cette élection.',
  [{ text: 'Tout le monde il est candidat' }]
);
console.log('french override', french.detectedLanguage, french.resolution);
if (french.detectedLanguage !== 'fr') {
  console.error('FAIL: expected fr for French transcript');
  process.exit(1);
}

console.log('ok');
