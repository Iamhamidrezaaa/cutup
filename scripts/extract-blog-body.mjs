import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'website/blog-ai-subtitle-generators-2026.html');
const html = readFileSync(src, 'utf8');
const m = html.match(/<article class="ba-article" id="baArticle">([\s\S]*?)<\/article>/);
if (!m) throw new Error('article block not found');
const dir = join(root, 'website/blog-pages/best-ai-subtitle-generators-2026');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'body.html'), m[1].trim());
console.log('Wrote body.html', m[1].trim().length, 'chars');
