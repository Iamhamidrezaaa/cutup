import fs from 'fs';

const files = process.argv.slice(2);
for (const p of files) {
  let t = fs.readFileSync(p, 'utf8');
  t = t.replace(/<motion /gi, '<div ').replace(/<\/motion>/gi, '</div>');
  t = t.replace(/function sanitizeHtml[\s\S]*?\n  \}\n\n/g, '');
  t = t.replace(/root\.innerHTML = sanitizeHtml\(root\.innerHTML\);\n/g, '');
  t = t.replace(/<\/motion>`\);/g, '</motion>`;');
  t = t.replace(/<\/motion>`;/g, '</div>`;');
  fs.writeFileSync(p, t);
  console.log('fixed', p);
}
