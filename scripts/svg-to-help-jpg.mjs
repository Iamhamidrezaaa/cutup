#!/usr/bin/env node
/** Convert help article SVG illustrations to JPG (1400px wide) for upload/deployment */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'website', 'help-illustrations', 'articles');
const WIDTH = 1400;

if (!existsSync(OUT)) {
  console.error('Missing folder:', OUT);
  process.exit(1);
}

const svgs = readdirSync(OUT).filter((f) => f.endsWith('.svg')).sort();
if (!svgs.length) {
  console.error('No SVG files found. Run: node scripts/generate-help-illustrations.mjs');
  process.exit(1);
}

let ok = 0;
const failed = [];
for (const file of svgs) {
  const svgPath = join(OUT, file);
  const jpgPath = join(OUT, file.replace(/\.svg$/i, '.jpg'));
  try {
    const svg = readFileSync(svgPath);
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: WIDTH },
      font: { loadSystemFonts: true },
    });
    const png = resvg.render().asPng();
    const jpg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    writeFileSync(jpgPath, jpg);
    ok += 1;
  } catch (err) {
    failed.push({ file, error: err.message });
  }
}
if (failed.length) {
  console.error('Failed conversions:', failed.slice(0, 5));
  process.exit(1);
}

console.log(`Wrote ${ok} JPG files (${WIDTH}px wide) to ${OUT}`);
