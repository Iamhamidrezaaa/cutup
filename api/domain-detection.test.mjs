import { detectContentDomain } from './domain-detection.js';

const fitness = detectContentDomain({
  transcript: 'Nice deadlift bro keep your core tight one more rep protein shake',
  title: 'Leg day workout'
});
console.log('fitness', fitness.domain, fitness.confidence, fitness.matchedSignals.slice(0, 5));
if (fitness.domain !== 'fitness') {
  console.error('FAIL fitness');
  process.exit(1);
}

const sales = detectContentDomain({
  transcript: 'We need to close this lead and improve conversion on the offer',
  description: 'Sales call script'
});
console.log('sales', sales.domain, sales.confidence);
if (sales.domain !== 'sales') {
  console.error('FAIL sales');
  process.exit(1);
}

const marketing = detectContentDomain({
  transcript: 'CTR dropped on this campaign ROAS is below target ad spend'
});
console.log('marketing', marketing.domain);
if (marketing.domain !== 'marketing') {
  console.error('FAIL marketing');
  process.exit(1);
}

const prog = detectContentDomain({
  transcript: 'Deploy to staging after merge pull request API repository'
});
console.log('programming', prog.domain);
if (prog.domain !== 'programming') {
  console.error('FAIL programming');
  process.exit(1);
}

console.log('ok');
