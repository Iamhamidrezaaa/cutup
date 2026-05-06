import { readFileSync, writeFileSync } from 'fs';
const p = new URL('../website/admin-usage.js', import.meta.url);
let c = readFileSync(p, 'utf8');
c = c.replace(/<motion /gi, '<div ');
c = c.replace(/<\/motion>/gi, '</motion>');
c = c.replace(/<\/motion>/gi, '</motion>');
c = c.replace(/<motion /gi, '<div ');
c = c.replace(/<\/motion>/gi, '</div>');
c = c.replace(
  /return `<motion class="usage-insights">/,
  'return `<div class="usage-insights">'
);
c = c.replace(
  `          </motion>
        </motion>
      </div>\`.replace(/<\\/motion>\\n        \\/<\\/div>/, '\\n        </div>');`,
  `          </div>
        </div>
      </motion>\`;`.replace('</motion>`;', '</motion>`;')
);
// fix pagination block
c = c.replace(
  /          <\/motion>\s*\n        <\/div>\s*\n      <\/motion>\.replace\([^)]+\);/,
  `          </div>
        </motion>
      </div>\`;`.replace('</motion>', '</div>')
);
writeFileSync(p, c);
console.log('done');
