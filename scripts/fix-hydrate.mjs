import { readFileSync, writeFileSync } from 'fs';

const p = 'api/cms-page-hydrate.js';
const lines = readFileSync(p, 'utf8').split(/\r?\n/);
const out = [];
let i = 0;
while (i < lines.length) {
  if (
    lines[i] === '  const cardRe =' &&
    lines[i + 1]?.includes('pricing-card') &&
    lines[i + 1]?.includes('motiondiv')
  ) {
    while (i < lines.length && !(lines[i] === '}' && lines[i + 1] === '' && lines[i + 2]?.startsWith('function sectionById'))) {
      i++;
    }
    i++;
    continue;
  }
  out.push(lines[i]);
  i++;
}
writeFileSync(p, out.join('\n'));
console.log('ok', out.length);
