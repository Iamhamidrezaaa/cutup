import {
  detectForeignContamination,
  stripForeignScripts,
  mergeFragmentedSubtitleCues,
  isPersianTargetLanguage,
  isPersianIncompleteThought
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

console.log('incomplete من فقط میخواهم یک', isPersianIncompleteThought('من فقط میخواهم یک'));
console.log('incomplete بارم آب', isPersianIncompleteThought('بارم آب با تو'));

const userFragments = mergeFragmentedSubtitleCues(
  [
    { start: 0, end: 2.1, text: 'من فقط میخواهم یک' },
    { start: 2.2, end: 4.0, text: 'بارم آب با تو' },
    { start: 4.1, end: 6.5, text: 'انجام بدم مهمه؟' }
  ],
  { persian: true }
);
console.log('user merge count', userFragments.length, userFragments[0]?.text);
if (userFragments.length !== 1) {
  console.error('FAIL: expected single merged cue');
  process.exit(1);
}

const merged = mergeFragmentedSubtitleCues(
  [
    { start: 0, end: 1, text: 'فقط یک' },
    { start: 1.1, end: 2.5, text: 'مثل اینکه' },
    { start: 2.6, end: 4, text: 'آیا می‌توانم کمک کنم؟' }
  ],
  { persian: true }
);
console.log('merged count', merged.length, merged[0]?.text);

console.log('isPersian fa', isPersianTargetLanguage('fa'));
