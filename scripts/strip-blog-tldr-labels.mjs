#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(process.cwd(), 'website', 'blog-pages');
let n = 0;
for (const name of readdirSync(dir, { withFileTypes: true })) {
  if (!name.isDirectory() || name.name.startsWith('_')) continue;
  const p = join(dir, name.name, 'body.html');
  if (!existsSync(p)) continue;
  const html = readFileSync(p, 'utf8');
  const next = html.replace(/<span[^>]*class="ba-tldr-label"[^>]*>[\s\S]*?<\/span>\s*/gi, '');
  if (next !== html) {
    writeFileSync(p, next);
    console.log('stripped', name.name);
    n++;
  }
}
console.log(`Done: ${n} files updated.`);
