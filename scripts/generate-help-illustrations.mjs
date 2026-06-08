#!/usr/bin/env node
/** Generate unique hero + inline SVG illustrations per help article */
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { HELP_ARTICLES } from '../api/help-center-content.js';
import { SLUG_SCENES } from './help-illustration-scenes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'website', 'help-illustrations', 'articles');

const BRAND = '#635BFF';
const BRAND2 = '#818CF8';
const BRAND_LIGHT = '#EEF2FF';
const SLATE = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function shell(title, body, h = 400) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ${h}" role="img" aria-label="${escXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FAFAFF"/><stop offset="100%" stop-color="#F8FAFC"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${BRAND}"/><stop offset="100%" stop-color="${BRAND2}"/>
    </linearGradient>
  </defs>
  <rect width="720" height="${h}" rx="16" fill="url(#bg)"/>
  <rect x="20" y="20" width="680" height="${h - 40}" rx="14" fill="#fff" stroke="${BORDER}"/>
  <text x="44" y="52" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="600" fill="${MUTED}">${escXml(title)}</text>
  ${body}
</svg>`;
}

function card(x, y, w, h, accent = false) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${accent ? BRAND_LIGHT : '#F8FAFC'}" stroke="${accent ? '#C7D2FE' : BORDER}"/>`;
}

function btn(x, y, w, label) {
  return `<rect x="${x}" y="${y}" width="${w}" height="34" rx="10" fill="url(#brand)"/><text x="${x + 16}" y="${y + 22}" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#fff">${escXml(label)}</text>`;
}

function bar(x, y, w, pct) {
  return `<rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="#E2E8F0"/><rect x="${x}" y="${y}" width="${Math.round(w * pct)}" height="8" rx="4" fill="${BRAND}"/>`;
}

function lines(x, y, w, n, accentIdx = -1) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const lw = w - (i % 3) * 40;
    const fill = i === accentIdx ? '#C7D2FE' : '#E2E8F0';
    s += `<rect x="${x}" y="${y + i * 22}" width="${lw}" height="10" rx="4" fill="${fill}"/>`;
  }
  return s;
}

function cutupChrome(main, label = 'Cutup') {
  return `
  <rect x="44" y="68" width="632" height="36" rx="8" fill="#F8FAFC" stroke="${BORDER}"/>
  <circle cx="64" cy="86" r="6" fill="#FCA5A5"/><circle cx="82" cy="86" r="6" fill="#FCD34D"/><circle cx="100" cy="86" r="6" fill="#86EFAC"/>
  <text x="360" y="90" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">${escXml(label)}</text>
  ${main}`;
}

const SCENES = {
  'home-transcribe': () => cutupChrome(`
    ${card(64, 120, 592, 240, true)}
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${SLATE}">Paste YouTube / Instagram link or upload</text>
    <rect x="88" y="172" width="460" height="44" rx="10" fill="#fff" stroke="#C7D2FE"/>
    <text x="104" y="200" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">https://youtube.com/watch?v=…</text>
    ${btn(560, 172, 72, 'Go')}
    ${btn(88, 240, 130, 'Transcribe')}
    ${bar(88, 290, 400, 0.55)}
    <text x="88" y="318" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Generating transcript…</text>`),

  'transcript-lines': () => cutupChrome(`
    ${card(64, 120, 592, 240)}
    <text x="88" y="152" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Transcript</text>
    ${lines(88, 168, 520, 6, 2)}
    <text x="88" y="310" font-family="monospace" font-size="10" fill="${BRAND}">00:00:12 — Edit text here</text>`, 'Transcript editor'),

  'format-grid': () => shell('Supported formats', `
    ${card(44, 72, 200, 300)}<text x="68" y="108" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">MP4</text>
    <rect x="68" y="124" width="152" height="80" rx="8" fill="${BRAND_LIGHT}"/><text x="88" y="172" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">H.264 + AAC</text>
    ${card(260, 72, 200, 300)}<text x="284" y="108" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">MOV / WEBM</text>
    <rect x="284" y="124" width="152" height="80" rx="8" fill="#F1F5F9"/>
    ${card(476, 72, 200, 300)}<text x="500" y="108" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">YouTube</text>
    <rect x="500" y="124" width="152" height="100" rx="8" fill="#0F172A"/><polygon points="560,158 560,188 588,173" fill="#fff"/>`),

  'upload-dropzone': () => cutupChrome(`
    ${card(64, 120, 592, 240, true)}
    <rect x="200" y="160" width="320" height="140" rx="12" fill="${BRAND_LIGHT}" stroke="#C7D2FE" stroke-dasharray="8 5"/>
    <text x="360" y="220" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="${BRAND}">Drop MP4, MOV or WEBM</text>
    <text x="360" y="242" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">or click to browse</text>`),

  'link-input': () => cutupChrome(`
    ${card(64, 120, 592, 200, true)}
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Import from link</text>
    <rect x="88" y="172" width="544" height="48" rx="10" fill="#fff" stroke="#C7D2FE"/>
    <text x="104" y="202" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">Paste public YouTube or Instagram URL</text>
    ${btn(88, 240, 120, 'Import')}`),

  'link-preview': () => cutupChrome(`
    ${card(64, 120, 280, 240)}
    <rect x="88" y="148" width="232" height="130" rx="8" fill="#0F172A"/><polygon points="188,198 188,228 216,213" fill="#fff"/>
    ${card(360, 120, 296, 240, true)}
    <text x="384" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Preview matches?</text>
    ${lines(384, 172, 240, 4)}
    ${btn(384, 280, 100, 'Confirm')}`),

  'processing-bar': () => cutupChrome(`${card(64, 120, 592, 200, true)}
    <text x="88" y="160" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Uploading &amp; processing</text>
    ${bar(88, 190, 520, 0.72)}
    <text x="88" y="220" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">72% — preparing transcription</text>`),

  'dashboard-hub': () => cutupChrome(`
    <rect x="64" y="120" width="130" height="240" rx="10" fill="${BRAND_LIGHT}" stroke="${BORDER}"/>
    <rect x="80" y="140" width="90" height="8" rx="4" fill="${BRAND}" opacity=".6"/>
    ${lines(80, 160, 90, 5)}
    ${card(210, 120, 200, 110, true)}
    <text x="230" y="150" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Credits remaining</text>
    <text x="230" y="190" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="${BRAND}">128</text>
    ${card(424, 120, 232, 110)}
    <text x="444" y="150" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">🔔 Notifications</text>
    ${card(210, 246, 446, 114)}
    <text x="230" y="276" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Recent projects</text>
    ${bar(230, 296, 380, 0.45)}`, 'Dashboard'),

  'sidebar-nav': () => cutupChrome(`
    <rect x="64" y="120" width="160" height="240" rx="10" fill="${BRAND_LIGHT}" stroke="#C7D2FE"/>
    <text x="84" y="152" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="${BRAND}">Content Library</text>
    <text x="84" y="178" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Plans</text>
    <text x="84" y="204" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Help Center</text>
    <text x="84" y="230" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Support</text>
    ${card(240, 120, 416, 240)}
    <text x="264" y="156" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Pick a section to get started</text>
    ${lines(264, 180, 360, 5)}`, 'Navigation'),

  'credits-card': () => cutupChrome(`${card(64, 120, 280, 240, true)}
    <text x="88" y="160" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Credits remaining</text>
    <text x="88" y="210" font-family="system-ui,sans-serif" font-size="44" font-weight="700" fill="${BRAND}">84</text>
    ${bar(88, 240, 200, 0.4)}
    ${card(360, 120, 296, 240)}
    <text x="384" y="160" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">This month</text>
    ${lines(384, 180, 240, 5)}`, 'Credits'),

  'plans-compare': () => cutupChrome(`
    ${card(64, 120, 200, 240)}<text x="88" y="156" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${MUTED}">Starter</text>
    <text x="88" y="196" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="${SLATE}">$9</text>
    ${card(280, 120, 200, 240, true)}<text x="304" y="156" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${BRAND}">Pro</text>
    <text x="304" y="196" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="${SLATE}">$29</text>
    ${card(496, 120, 160, 240)}<text x="520" y="156" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${MUTED}">Team</text>
    <text x="520" y="196" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="${SLATE}">$79</text>`, 'Plans'),

  'video-burnin': () => cutupChrome(`
    ${card(64, 120, 360, 240, true)}
    <rect x="88" y="148" width="312" height="176" rx="8" fill="#0F172A"/>
    <rect x="120" y="280" width="220" height="28" rx="4" fill="#fff" opacity=".92"/>
    <text x="136" y="299" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Burned-in captions on video</text>
    ${card(440, 120, 216, 240)}
    <text x="464" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Export MP4</text>
    ${btn(464, 180, 140, 'Start export')}`, 'Export'),

  'export-download': () => cutupChrome(`${card(64, 120, 592, 200, true)}
    ${bar(88, 170, 520, 1)}
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#16A34A">✓ Export complete</text>
    ${btn(88, 230, 180, 'Download MP4')}`),

  'srt-preview': () => cutupChrome(`
    <rect x="64" y="120" width="360" height="240" rx="10" fill="#0F172A"/>
    <text x="88" y="300" font-family="monospace" font-size="11" fill="#fff">1\n00:00:01,000 --&gt; 00:00:04,000\nHello world</text>
    ${card(440, 120, 216, 240, true)}
    <text x="464" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">SRT format</text>
    ${lines(464, 172, 170, 5)}`),

  'srt-download': () => cutupChrome(`${card(64, 120, 592, 180, true)}
    <text x="88" y="160" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">project-en.srt</text>
    ${btn(88, 200, 160, 'Download SRT')}`),

  'txt-document': () => cutupChrome(`${card(64, 120, 592, 240)}
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Plain text transcript</text>
    ${lines(88, 172, 520, 8)}`),

  'txt-download': () => cutupChrome(`${btn(88, 160, 160, 'Export TXT')}${lines(88, 220, 400, 4)}`),

  'export-error': () => cutupChrome(`${card(64, 120, 592, 200)}
    <text x="88" y="170" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#DC2626">Export failed</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">Source expired or codec unsupported</text>`),

  'export-retry': () => cutupChrome(`${btn(88, 160, 120, 'Retry')}${btn(220, 160, 140, 'Contact support')}`),

  'export-queue': () => cutupChrome(`
    ${card(64, 120, 592, 240, true)}
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Queue</text>
    <rect x="88" y="172" width="544" height="44" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">MP4 · Processing</text>${bar(400, 188, 200, 0.6)}
    <rect x="88" y="228" width="544" height="44" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="256" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">SRT · Waiting</text>`),

  'queue-status': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">2 jobs ahead · est. 8 min</text>${bar(88, 190, 400, 0.35)}`),

  'content-library': () => cutupChrome(`
    ${card(64, 120, 592, 240)}
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Content library</text>
    <rect x="88" y="172" width="544" height="48" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="202" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Interview-final.mp4 · Completed</text>
    <rect x="88" y="232" width="544" height="48" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="262" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Podcast-ep3.srt · Completed</text>`),

  'redownload': () => cutupChrome(`${btn(88, 160, 160, 'Re-download')}`),

  'audio-waveform': () => shell('Audio quality', `
    ${card(44, 72, 632, 300, true)}
    <text x="68" y="110" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Clear speech waveform</text>
    ${Array.from({length: 40}, (_, i) => `<rect x="${68 + i * 14}" y="${200 - (i % 7) * 8}" width="8" height="${20 + (i % 5) * 12}" rx="2" fill="${i % 3 ? '#C7D2FE' : BRAND}"/>`).join('')}`),

  'accuracy-tips': () => cutupChrome(`<text x="88" y="160" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">✓ Reduce background music</text>
    <text x="88" y="190" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">✓ Use external mic</text>
    <text x="88" y="220" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">✓ Fix names in first minute</text>`),

  'editor-highlight': () => cutupChrome(`${card(64, 120, 592, 240, true)}
    ${lines(88, 156, 520, 5, 2)}
    <rect x="200" y="200" width="180" height="24" rx="4" fill="#FEF08A"/>`),

  'editor-save': () => cutupChrome(`${btn(88, 160, 100, 'Save')}`),

  'timeline-cues': () => cutupChrome(`
    <rect x="64" y="200" width="592" height="4" rx="2" fill="#E2E8F0"/>
    <rect x="120" y="188" width="4" height="28" fill="${BRAND}"/><rect x="280" y="188" width="4" height="28" fill="${BRAND}"/><rect x="440" y="188" width="4" height="28" fill="${BRAND}"/>
    <text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Caption timeline</text>`),

  'cue-adjust': () => cutupChrome(`<text x="88" y="170" font-family="monospace" font-size="11" fill="${SLATE}">00:00:12,500 → 00:00:15,000</text>${btn(88, 200, 120, 'Apply')}`),

  'speaker-tags': () => cutupChrome(`
    <rect x="88" y="160" width="80" height="24" rx="6" fill="${BRAND_LIGHT}"/><text x="100" y="177" font-family="system-ui,sans-serif" font-size="10" fill="${BRAND}">Speaker 1</text>
    ${lines(180, 160, 420, 2)}
    <rect x="88" y="210" width="80" height="24" rx="6" fill="#F1F5F9"/><text x="100" y="227" font-family="system-ui,sans-serif" font-size="10" fill="${MUTED}">Speaker 2</text>
    ${lines(180, 210, 400, 2)}`),

  'speaker-rename': () => cutupChrome(`<rect x="88" y="160" width="200" height="36" rx="8" fill="#fff" stroke="#C7D2FE"/><text x="104" y="184" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Host name</text>`),

  'text-format': () => cutupChrome(`${lines(88, 160, 520, 6)}`),

  'format-preview': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">"Hello, world — ready to publish."</text>`),

  'preview-player': () => cutupChrome(`
    <rect x="64" y="120" width="400" height="240" rx="10" fill="#0F172A"/><polygon points="240,220 240,260 280,240" fill="#fff"/>
    ${card(480, 120, 176, 240, true)}${lines(504, 156, 130, 7)}`),

  'preview-scroll': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Scroll transcript while video plays</text>`),

  'translation-split': () => cutupChrome(`
    ${card(64, 120, 280, 240)}
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Source · English</text>
    ${lines(88, 172, 220, 5)}
    <path d="M360 240h40" stroke="${BRAND}" stroke-width="3"/><path d="M388 224l16 16-16 16" stroke="${BRAND}" stroke-width="3" fill="none"/>
    ${card(416, 120, 240, 240, true)}
    <text x="440" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${BRAND}">Target · Spanish</text>
    ${lines(440, 172, 200, 5, 1)}`, 'Translation'),

  'lang-picker': () => cutupChrome(`
    <rect x="88" y="160" width="240" height="44" rx="10" fill="#fff" stroke="#C7D2FE"/>
    <text x="104" y="188" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Target language ▾</text>
    <rect x="88" y="216" width="240" height="120" rx="10" fill="#fff" stroke="${BORDER}"/>
    <text x="104" y="244" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">Spanish</text>
    <text x="104" y="268" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">French</text>
    <text x="104" y="292" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">German</text>`),

  'lang-list': () => shell('Languages', `
    ${['English','Spanish','French','German','Arabic','Japanese','Portuguese','Hindi'].map((l, i) =>
      `<rect x="${44 + (i % 4) * 160}" y="${72 + Math.floor(i / 4) * 80}" width="140" height="56" rx="10" fill="${i === 1 ? BRAND_LIGHT : '#F8FAFC'}" stroke="${i === 1 ? '#C7D2FE' : BORDER}"/><text x="${64 + (i % 4) * 160}" y="${106 + Math.floor(i / 4) * 80}" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">${l}</text>`
    ).join('')}`),

  'lang-select': () => SCENES['lang-picker'](),

  'dual-track': () => cutupChrome(`
    <rect x="88" y="160" width="520" height="36" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="184" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">EN: Welcome to the show</text>
    <rect x="88" y="206" width="520" height="36" rx="8" fill="${BRAND_LIGHT}" stroke="#C7D2FE"/><text x="104" y="230" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">ES: Bienvenidos al programa</text>`),

  'dual-preview': () => SCENES['dual-track'](),

  'review-translation': () => cutupChrome(`${lines(88, 160, 520, 4, 2)}<text x="88" y="280" font-family="system-ui,sans-serif" font-size="11" fill="#DC2626">⚠ Review idiom on line 3</text>`),

  'glossary-edit': () => cutupChrome(`<rect x="88" y="160" width="160" height="32" rx="6" fill="${BRAND_LIGHT}"/><text x="104" y="182" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">Brand term → glossary</text>`),

  'translated-srt': () => SCENES['srt-preview'](),

  'per-lang-download': () => cutupChrome(`
    <text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">project-es.srt</text>${btn(88, 190, 120, 'Download')}
    <text x="88" y="250" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">project-fr.srt</text>${btn(88, 270, 120, 'Download')}`),

  'translation-cost': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Translation uses credits per minute</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="${BRAND}">−12</text>`),

  'credit-deduct': () => cutupChrome(`${bar(88, 180, 400, 0.65)}<text x="88" y="210" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Credits after translation</text>`),

  'plan-upgrade': () => SCENES['plans-compare'](),

  'plan-downgrade': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">Downgrade effective at period end</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Mar 31, 2026</text>`),

  'period-end': () => SCENES['plan-downgrade'](),

  'checkout': () => cutupChrome(`${btn(88, 160, 140, 'Confirm upgrade')}`),

  'card-declined': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#DC2626">Card declined</text>
    <rect x="88" y="190" width="320" height="44" rx="8" fill="#FEF2F2" stroke="#FECACA"/><text x="104" y="218" font-family="system-ui,sans-serif" font-size="11" fill="#DC2626">Try another card or contact bank</text>`),

  'update-card': () => cutupChrome(`${btn(88, 160, 180, 'Update payment method')}`),

  'invoice-list': () => SCENES['invoices']?.() || cutupChrome(`${lines(88, 160, 500, 4)}`),

  'invoice-pdf': () => cutupChrome(`${btn(88, 160, 140, 'Download PDF')}`),

  'vat-form': () => cutupChrome(`<rect x="88" y="160" width="320" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="186" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">VAT ID (EU B2B)</text>`),

  'tax-line': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Subtotal $29.00 · VAT $5.80</text>`),

  'refund-request': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">Open support ticket for refund review</text>${btn(88, 200, 130, 'New ticket')}`),

  'refund-status': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${BRAND}">Under review · 3–5 business days</text>`),

  'usage-chart': () => cutupChrome(`${Array.from({length: 7}, (_, i) => `<rect x="${88 + i * 72}" y="${240 - (i % 4 + 1) * 30}" width="48" height="${(i % 4 + 1) * 30}" rx="4" fill="${i === 5 ? BRAND : '#C7D2FE'}"/>`).join('')}`),

  'usage-filter': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Filter: Transcribe · Export · Translate</text>`),

  'usage-events': () => cutupChrome(`
    <rect x="88" y="160" width="544" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="186" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Transcribe · −8 credits</text>
    <rect x="88" y="210" width="544" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="236" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Export MP4 · −15 credits</text>`),

  'credits-low': () => cutupChrome(`<text x="88" y="180" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="#DC2626">12</text>
    <text x="88" y="210" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Credits remaining — running low</text>`),

  'top-up': () => cutupChrome(`${btn(88, 160, 120, 'Upgrade plan')}`),

  'reset-calendar': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">Credits reset monthly on billing date</text>
    <text x="88" y="210" font-family="system-ui,sans-serif" font-size="24" font-weight="700" fill="${BRAND}">Apr 14</text>`),

  'reset-countdown': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">12 days until refresh</text>${bar(88, 190, 300, 0.6)}`),

  'cost-compare': () => cutupChrome(`
    <text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Transcribe</text>${bar(180, 162, 200, 0.3)}
    <text x="88" y="210" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Export MP4</text>${bar(180, 202, 200, 0.8)}`),

  'action-cost': () => SCENES['cost-compare'](),

  'efficiency-tips': () => SCENES['accuracy-tips'](),

  'batch-workflow': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Batch 3 similar videos in one session</text>`),

  'profile-form': () => cutupChrome(`
    <circle cx="120" cy="200" r="36" fill="${BRAND_LIGHT}" stroke="#C7D2FE"/>
    ${card(180, 140, 460, 48)}<text x="200" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Full name</text>
    ${card(180, 200, 460, 48)}<text x="200" y="230" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Country</text>
    ${card(180, 260, 460, 48)}<text x="200" y="290" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Email</text>`, 'Profile'),

  'profile-save': () => cutupChrome(`${btn(88, 160, 120, 'Save changes')}`),

  'notif-toggles': () => cutupChrome(`
    <rect x="88" y="160" width="520" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="186" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Export completed</text><circle cx="580" cy="180" r="10" fill="${BRAND}"/>
    <rect x="88" y="212" width="520" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="238" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Low credits alert</text><circle cx="580" cy="232" r="10" fill="${BRAND}"/>`),

  'notif-email': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Email me for billing receipts only</text>`),

  'ticket-thread': () => cutupChrome(`
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Ticket #1042</text>
    <rect x="88" y="172" width="400" height="52" rx="10" fill="#fff" stroke="${BORDER}"/><text x="104" y="204" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">How do I update my invoice?</text>
    <rect x="88" y="236" width="360" height="44" rx="10" fill="${BRAND_LIGHT}"/><text x="104" y="264" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">Support team replied</text>`, 'Support'),

  'ticket-attach': () => cutupChrome(`<rect x="88" y="160" width="140" height="44" rx="8" fill="#F8FAFC" stroke="${BORDER}"/><text x="104" y="188" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">📎 screenshot.png</text>`),

  'security-overview': () => cutupChrome(`<path d="M360 150l-36-20v40l36 20 36-20v-40l-36 20z" fill="${BRAND_LIGHT}" stroke="${BRAND}" stroke-width="2"/>
    <text x="88" y="160" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${SLATE}">Your account is protected</text>${lines(88, 190, 240, 3)}`),

  'session-list': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Chrome · Windows · Active now</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Safari · iPhone · 2 days ago</text>`),

  'google-link': () => cutupChrome(`<circle cx="120" cy="200" r="28" fill="#fff" stroke="${BORDER}"/><text x="120" y="206" text-anchor="middle" font-size="18">G</text>
    <text x="168" y="200" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">Signed in with Google</text>`),

  'google-switch': () => cutupChrome(`${btn(88, 160, 160, 'Switch account')}`),

  'delete-request': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="#DC2626">Request permanent deletion</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">All projects and data will be removed</text>`),

  'delete-confirm': () => cutupChrome(`${btn(88, 160, 140, 'Submit request')}`),

  'data-retention': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Library retention by plan</text>${lines(88, 190, 400, 4)}`),

  'retention-policy': () => SCENES['data-retention'](),

  'encryption-lock': () => shell('Encryption', `
    <path d="M360 120l-56-32v64l56 32 56-32v-64l-56 32z" fill="${BRAND_LIGHT}" stroke="${BRAND}" stroke-width="3"/>
    <rect x="330" y="200" width="60" height="48" rx="8" fill="${BRAND}"/><circle cx="360" cy="216" r="8" fill="#fff"/>`),

  'storage-stack': () => cutupChrome(`${card(88, 160, 160, 100)}${card(108, 180, 160, 100)}${card(128, 200, 160, 100, true)}`),

  'session-timeout': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Sessions expire after inactivity</text>${bar(88, 190, 300, 0.8)}`),

  'logout-all': () => cutupChrome(`${btn(88, 160, 160, 'Log out everywhere')}`),

  'google-2fa': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">Enable 2-Step Verification on Google</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">myaccount.google.com/security</text>`),

  'google-apps': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Review apps connected to Google</text>`),

  'gdpr-export': () => cutupChrome(`${btn(88, 160, 140, 'Export my data')}`),

  'gdpr-erasure': () => cutupChrome(`${btn(88, 160, 140, 'Request erasure')}`),

  'security-report': () => cutupChrome(`<text x="88" y="170" font-family="system-ui,sans-serif" font-size="13" fill="${SLATE}">Report vulnerability responsibly</text>
    <text x="88" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">security@cutup.app</text>`),

  'security-email': () => SCENES['security-report'](),

  'invoices': () => cutupChrome(`
    <text x="88" y="156" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Billing history</text>
    <rect x="88" y="172" width="544" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="198" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">INV-2026-014 · $29.00</text><text x="560" y="198" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">PDF</text>
    <rect x="88" y="220" width="544" height="40" rx="8" fill="#fff" stroke="${BORDER}"/><text x="104" y="246" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">INV-2026-003 · $29.00</text><text x="560" y="246" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">PDF</text>`, 'Billing'),
};

function renderScene(type, label) {
  const fn = SCENES[type];
  if (fn) return fn();
  return shell(label || type, `${card(80, 80, 560, 260, true)}${lines(104, 120, 500, 6)}`);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Remove legacy single-file illustrations
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.svg') && !f.includes('-hero') && !f.includes('-inline')) {
    try { unlinkSync(join(OUT, f)); } catch { /* noop */ }
  }
}

let count = 0;
for (const art of HELP_ARTICLES) {
  const scene = SLUG_SCENES[art.slug] || {
    hero: 'home-transcribe',
    inline: 'transcript-lines',
    heroLabel: art.title,
    inlineLabel: 'Step in action',
  };
  const heroSvg = renderScene(scene.hero, scene.heroLabel || art.title);
  const inlineSvg = renderScene(scene.inline, scene.inlineLabel || 'Example');
  writeFileSync(join(OUT, `${art.slug}-hero.svg`), heroSvg, 'utf8');
  writeFileSync(join(OUT, `${art.slug}-inline.svg`), inlineSvg, 'utf8');
  count += 2;
}

console.log(`Generated ${count} illustrations (${HELP_ARTICLES.length} articles × 2) in ${OUT}`);
