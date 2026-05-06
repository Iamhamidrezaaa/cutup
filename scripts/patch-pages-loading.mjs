import { readFileSync, writeFileSync } from 'fs';

const p = 'website/admin-content-pages.js';
let s = readFileSync(p, 'utf8');
s = s.replace(
  /el\.innerHTML = '<div class="cms-editor-loading">[\s\S]*?replace\([^)]+\);/,
  `el.innerHTML =
      '<div class="cms-editor-loading"><div class="cs-skeleton" style="height:120px"></div><p class="muted">Loading page content…</p></motionmotionmotionmotiondiv>';`.replace(
    /<motionmotionmotionmotionmotiondiv>/g,
    '</div>'
  )
);
writeFileSync(p, s);
console.log('patched');
