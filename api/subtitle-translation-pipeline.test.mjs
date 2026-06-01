import {
  detectForeignContamination,
  stripForeignScripts,
  mergeFragmentedSubtitleCues,
  isPersianTargetLanguage
} from './subtitle-translation-pipeline.js';

const fa = 'fa';
const samples = [
  { text: 'این یک تست است', ok: true },
  { text: 'इसलिए مهم است', ok: false },
  { text: 'فقط یک', ok: true },
  { text: 'hello world', ok: false }
];

for (const s of samples) {
  const d = detectForeignContamination(s.text, fa);
  console.log(s.text, 'contaminated=', d.contaminated, d.hits.map((h) => h.script));
}

const stripped = stripForeignScripts('این इसलिए vì مهم است', fa);
console.log('stripped:', stripped.text);

const merged = mergeFragmentedSubtitleCues([
  { start: 0, end: 1, text: 'فقط یک' },
  { start: 1.1, end: 2.5, text: 'مثل اینکه' },
  { start: 2.6, end: 4, text: 'آیا می‌توانم کمک کنم؟' }
]);
console.log('merged count', merged.length, merged[0]?.text);

console.log('isPersian fa', isPersianTargetLanguage('fa'));
