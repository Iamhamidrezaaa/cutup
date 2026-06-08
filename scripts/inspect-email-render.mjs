import { writeFileSync } from 'fs';
import { renderEmailTemplate } from '../api/email-platform/index.js';

const r = await renderEmailTemplate('WELCOME_EMAIL', { firstName: 'Alex' });
const h = r.html;
writeFileSync('scripts/_welcome-preview.html', h);

const checks = {
  hasBlockHeroClass: h.includes('email-block-hero'),
  hasBlockBadgeClass: h.includes('email-block-badge'),
  hasLiteralTemplate: h.includes('${BRAND'),
  heroPadInCss: h.match(/\.email-block-hero\s*\{[^}]+\}/)?.[0],
  badgePadInCss: h.match(/\.email-block-badge\s*\{[^}]+\}/)?.[0],
  bodyWrapPad: h.match(/\.email-body-wrap\s*\{[^}]+\}/)?.[0],
  classOnTable: h.match(/class="email-block-hero"/)?.[0],
  inlinePaddingSamples: [...h.matchAll(/padding:\s*[^;"]+/g)].slice(0, 15).map((m) => m[0]),
};

console.log(JSON.stringify(checks, null, 2));
