#!/usr/bin/env node
/**
 * Encode cookies/instagram_cookies.txt as INSTAGRAM_COOKIES_BASE64 for .env
 * Usage: node scripts/encode-instagram-cookies.mjs [path-to-cookies.txt]
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const input =
  process.argv[2] || join(root, 'cookies', 'instagram_cookies.txt');

if (!existsSync(input)) {
  console.error('File not found:', input);
  process.exit(1);
}

const content = readFileSync(input, 'utf8').replace(/^\uFEFF/, '').trimEnd();
if (!content.includes('instagram.com') || !content.includes('sessionid')) {
  console.error('File does not look like a valid Instagram Netscape cookies export.');
  process.exit(1);
}

const b64 = Buffer.from(`${content}\n`, 'utf8').toString('base64');
console.log('Add this line to your server .env (then pm2 restart):\n');
console.log(`INSTAGRAM_COOKIES_BASE64=${b64}`);
