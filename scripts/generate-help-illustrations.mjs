#!/usr/bin/env node
/** Generate unique contextual SVG illustrations per help article */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { HELP_ARTICLES } from '../api/help-center-content.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'website', 'help-illustrations', 'articles');

const BRAND = '#635BFF';
const BRAND_LIGHT = '#EEF2FF';
const SLATE = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

function shell(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 400" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FAFAFF"/>
      <stop offset="100%" stop-color="#F8FAFC"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#635BFF"/>
      <stop offset="100%" stop-color="#818CF8"/>
    </linearGradient>
  </defs>
  <rect width="720" height="400" rx="16" fill="url(#bg)"/>
  <rect x="24" y="24" width="672" height="352" rx="14" fill="#fff" stroke="${BORDER}"/>
  ${title ? `<text x="48" y="58" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${MUTED}">${title}</text>` : ''}
  ${body}
</svg>`;
}

function sidebar(x = 48, y = 80) {
  return `
  <rect x="${x}" y="${y}" width="120" height="260" rx="10" fill="${BRAND_LIGHT}" stroke="${BORDER}"/>
  <rect x="${x + 16}" y="${y + 20}" width="72" height="8" rx="4" fill="${BRAND}" opacity=".35"/>
  <rect x="${x + 16}" y="${y + 40}" width="88" height="6" rx="3" fill="#CBD5E1"/>
  <rect x="${x + 16}" y="${y + 56}" width="88" height="6" rx="3" fill="#CBD5E1"/>
  <rect x="${x + 16}" y="${y + 72}" width="88" height="6" rx="3" fill="${BRAND}" opacity=".5"/>
  <rect x="${x + 16}" y="${y + 88}" width="88" height="6" rx="3" fill="#CBD5E1"/>`;
}

function card(x, y, w, h, accent = false) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${accent ? BRAND_LIGHT : '#F8FAFC'}" stroke="${accent ? '#C7D2FE' : BORDER}"/>`;
}

function btn(x, y, w, label) {
  return `<rect x="${x}" y="${y}" width="${w}" height="32" rx="8" fill="url(#brand)"/><text x="${x + 14}" y="${y + 21}" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#fff">${label}</text>`;
}

function progress(x, y, w, pct) {
  return `<rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="#E2E8F0"/><rect x="${x}" y="${y}" width="${Math.round(w * pct)}" height="8" rx="4" fill="${BRAND}"/>`;
}

const builders = {
  'quick-start-guide': () => shell('Quick start', `${sidebar()}${card(192, 80, 480, 120, true)}
    <text x="216" y="118" font-family="system-ui,sans-serif" font-size="14" fill="${SLATE}">Paste link or upload video</text>
    ${btn(216, 140, 120, 'Transcribe')}
    ${progress(216, 188, 320, 0.65)}
    <text x="216" y="214" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Generating transcript…</text>`),

  'supported-video-formats': () => shell('Supported formats', `
    ${card(48, 80, 200, 260)}
    <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Upload</text>
    <rect x="72" y="128" width="152" height="48" rx="8" fill="${BRAND_LIGHT}" stroke="#C7D2FE" stroke-dasharray="6 4"/>
    <text x="88" y="158" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">MP4 · MOV · WEBM</text>
    ${card(272, 80, 200, 260)}
    <text x="296" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">YouTube</text>
    <rect x="296" y="128" width="152" height="90" rx="8" fill="#0F172A" opacity=".85"/>
    <polygon points="340,158 340,188 368,173" fill="#fff"/>
    ${card(496, 80, 176, 260)}
    <text x="520" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Instagram</text>
    <rect x="520" y="128" width="128" height="128" rx="8" fill="url(#brand)" opacity=".15"/>`),

  'dashboard-overview': () => shell('Dashboard', `${sidebar()}
    ${card(192, 80, 220, 100, true)}
    <text x="212" y="108" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Credits remaining</text>
    <text x="212" y="140" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="${BRAND}">128</text>
    ${card(428, 80, 244, 100)}
    <circle cx="456" cy="118" r="14" fill="${BRAND_LIGHT}"/><text x="480" y="122" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">Notifications</text>
    ${card(192, 196, 480, 144)}
    <text x="212" y="224" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Recent activity</text>
    ${progress(212, 244, 400, 0.4)}
    ${btn(212, 280, 140, 'Support Center')}`),

  'export-mp4': () => shell('Export MP4', `
    ${card(48, 80, 280, 260, true)}
    <rect x="72" y="108" width="232" height="130" rx="8" fill="#0F172A"/>
    <rect x="88" y="200" width="180" height="24" rx="4" fill="#fff" opacity=".9"/>
    <text x="100" y="216" font-family="system-ui,sans-serif" font-size="10" fill="${SLATE}">Burned-in captions preview</text>
    ${card(352, 80, 320, 260)}
    <text x="376" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Export progress</text>
    ${progress(376, 132, 260, 0.78)}
    <text x="376" y="168" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Rendering MP4… 78%</text>
    ${btn(376, 200, 160, 'Download MP4')}`),

  'translate-captions': () => shell('Translation', `
    ${card(48, 80, 280, 260)}
    <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Source · English</text>
    <rect x="72" y="128" width="232" height="8" rx="4" fill="#E2E8F0"/><rect x="72" y="148" width="200" height="8" rx="4" fill="#E2E8F0"/>
    <path d="M344 200h32" stroke="${BRAND}" stroke-width="3"/><path d="M368 188l12 12-12 12" stroke="${BRAND}" stroke-width="3" fill="none"/>
    ${card(400, 80, 272, 260, true)}
    <text x="424" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${BRAND}">Target · Spanish</text>
    <rect x="424" y="128" width="224" height="8" rx="4" fill="#C7D2FE"/><rect x="424" y="148" width="180" height="8" rx="4" fill="#C7D2FE"/>`),

  'upgrade-plan': () => shell('Billing', `
    ${card(120, 80, 220, 260)}
    <text x="144" y="120" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${SLATE}">Starter</text>
    <text x="144" y="156" font-family="system-ui,sans-serif" font-size="24" font-weight="700" fill="${MUTED}">$9</text>
    ${card(360, 80, 240, 260, true)}
    <text x="384" y="120" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${BRAND}">Pro</text>
    <text x="384" y="156" font-family="system-ui,sans-serif" font-size="24" font-weight="700" fill="${SLATE}">$29</text>
    ${btn(384, 200, 120, 'Upgrade')}`),

  'update-profile-information': () => shell('Profile settings', `
    <circle cx="120" cy="150" r="40" fill="${BRAND_LIGHT}" stroke="#C7D2FE"/>
    <text x="180" y="140" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="${SLATE}">Your profile</text>
    ${card(180, 160, 480, 48)}
    <text x="200" y="190" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">Full name</text>
    ${card(180, 220, 480, 48)}
    <text x="200" y="250" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">Country</text>
    ${btn(180, 290, 120, 'Save changes')}`),

  'understand-credit-usage': () => shell('Credits', `
    ${card(160, 80, 400, 260, true)}
    <text x="200" y="130" font-family="system-ui,sans-serif" font-size="40" font-weight="700" fill="${BRAND}">84</text>
    <text x="200" y="158" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">credits remaining</text>
    ${progress(200, 190, 320, 0.35)}
    <text x="200" y="230" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Transcribe · Export · Translate</text>`),

  'support-preferences': () => shell('Support ticket', `
    ${card(48, 80, 624, 260, true)}
    <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Ticket #1042 · Billing</text>
    <rect x="72" y="128" width="420" height="56" rx="10" fill="#fff" stroke="${BORDER}"/>
    <text x="88" y="162" font-family="system-ui,sans-serif" font-size="12" fill="${SLATE}">How do I update my invoice address?</text>
    <rect x="72" y="196" width="320" height="44" rx="10" fill="${BRAND_LIGHT}" stroke="#C7D2FE"/>
    <text x="88" y="224" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">Support replied · 2h ago</text>
    <rect x="420" y="196" width="120" height="44" rx="10" fill="#F8FAFC" stroke="${BORDER}"/>
    <text x="440" y="224" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">📎 invoice.pdf</text>`),

  'invoices': () => shell('Invoices', `
    ${card(120, 80, 480, 260, true)}
    <text x="144" y="120" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Billing history</text>
    <rect x="144" y="140" width="432" height="40" rx="8" fill="#fff" stroke="${BORDER}"/>
    <text x="160" y="166" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">INV-2026-014 · Pro plan</text>
    <text x="480" y="166" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">PDF ↓</text>
    <rect x="144" y="188" width="432" height="40" rx="8" fill="#fff" stroke="${BORDER}"/>
    <text x="160" y="214" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">INV-2026-003 · Pro plan</text>
    <text x="480" y="214" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">PDF ↓</text>`),

  'export-srt-subtitles': () => shell('Export SRT', `
    ${card(48, 80, 300, 260)}
    <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Subtitle preview</text>
    <rect x="72" y="128" width="252" height="120" rx="8" fill="#0F172A"/>
    <text x="88" y="188" font-family="monospace" font-size="10" fill="#fff">00:01:02 → Hello world</text>
    ${card(368, 80, 304, 260, true)}
    <text x="392" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Download</text>
    ${btn(392, 140, 160, 'Download SRT')}
    <text x="392" y="200" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">UTF-8 · broadcast-ready</text>`),

  'notification-preferences': () => shell('Notifications', `
    ${sidebar()}
    ${card(192, 80, 480, 260, true)}
    <text x="216" y="118" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Notification preferences</text>
    <rect x="216" y="140" width="400" height="36" rx="8" fill="#fff" stroke="${BORDER}"/>
    <text x="232" y="163" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Export completed</text>
    <circle cx="580" cy="158" r="10" fill="${BRAND}"/>
    <rect x="216" y="188" width="400" height="36" rx="8" fill="#fff" stroke="${BORDER}"/>
    <text x="232" y="211" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">Billing receipts</text>
    <circle cx="580" cy="206" r="10" fill="#E2E8F0"/>`),
};

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

const categoryTemplates = {
  exports(slug, title) {
    const pct = 0.35 + (slug.length % 5) * 0.1;
    return shell(title.slice(0, 36), `
      ${card(48, 80, 280, 260, true)}
      <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Export queue</text>
      ${progress(72, 132, 232, pct)}
      <text x="72" y="168" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">${escXml(title.slice(0, 28))}</text>
      ${btn(72, 200, 140, 'Download')}
      ${card(352, 80, 320, 260)}
      <rect x="376" y="108" width="272" height="150" rx="8" fill="#0F172A"/>
      <rect x="392" y="220" width="200" height="20" rx="4" fill="#fff" opacity=".85"/>`);
  },
  transcripts(slug, title) {
    return shell(title.slice(0, 36), `
      ${card(80, 80, 560, 260, true)}
      <text x="104" y="116" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Transcript editor</text>
      <rect x="104" y="136" width="500" height="10" rx="4" fill="#E2E8F0"/>
      <rect x="104" y="158" width="440" height="10" rx="4" fill="#C7D2FE"/>
      <rect x="104" y="180" width="480" height="10" rx="4" fill="#E2E8F0"/>
      <rect x="104" y="202" width="360" height="10" rx="4" fill="#E2E8F0"/>
      <text x="104" y="248" font-family="monospace" font-size="10" fill="${MUTED}">00:00:12 — ${escXml(title.slice(0, 24))}</text>`);
  },
  translation(slug, title) {
    const langs = ['English', 'Spanish', 'French', 'German', 'Arabic'];
    const target = langs[slug.length % langs.length];
    return shell(title.slice(0, 36), `
      ${card(48, 80, 280, 260)}
      <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Source · English</text>
      <rect x="72" y="128" width="232" height="8" rx="4" fill="#E2E8F0"/><rect x="72" y="148" width="200" height="8" rx="4" fill="#E2E8F0"/>
      <path d="M344 200h32" stroke="${BRAND}" stroke-width="3"/><path d="M368 188l12 12-12 12" stroke="${BRAND}" stroke-width="3" fill="none"/>
      ${card(400, 80, 272, 260, true)}
      <text x="424" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${BRAND}">Target · ${target}</text>
      <rect x="424" y="128" width="224" height="8" rx="4" fill="#C7D2FE"/><rect x="424" y="148" width="180" height="8" rx="4" fill="#C7D2FE"/>`);
  },
  billing(slug, title) {
    return shell(title.slice(0, 36), `
      ${card(140, 80, 200, 260)}
      <text x="164" y="120" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${MUTED}">Current</text>
      <text x="164" y="156" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="${SLATE}">Starter</text>
      ${card(360, 80, 220, 260, true)}
      <text x="384" y="120" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${BRAND}">Subscription</text>
      <text x="384" y="156" font-family="system-ui,sans-serif" font-size="14" fill="${SLATE}">${escXml(title.slice(0, 22))}</text>
      ${btn(384, 200, 120, 'Manage')}`);
  },
  credits(slug, title) {
    const n = 40 + (slug.length * 3) % 80;
    return shell(title.slice(0, 36), `
      ${card(160, 80, 400, 260, true)}
      <text x="200" y="124" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Monthly balance</text>
      <text x="200" y="168" font-family="system-ui,sans-serif" font-size="40" font-weight="700" fill="${BRAND}">${n}</text>
      ${progress(200, 190, 320, n / 120)}
      <text x="200" y="240" font-family="system-ui,sans-serif" font-size="11" fill="${SLATE}">${escXml(title.slice(0, 32))}</text>`);
  },
  account(slug, title) {
    return shell(title.slice(0, 36), `
      <circle cx="120" cy="180" r="44" fill="${BRAND_LIGHT}" stroke="#C7D2FE"/>
      <text x="120" y="188" text-anchor="middle" font-size="28">👤</text>
      ${card(200, 100, 472, 220, true)}
      <text x="224" y="136" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${SLATE}">${escXml(title.slice(0, 30))}</text>
      ${card(224, 156, 424, 44)}
      <text x="244" y="184" font-family="system-ui,sans-serif" font-size="12" fill="${MUTED}">Preference field</text>
      ${btn(224, 220, 120, 'Save')}`);
  },
  security(slug, title) {
    return shell(title.slice(0, 36), `
      ${card(120, 80, 480, 260, true)}
      <path d="M360 140l-40-24v48l40 24 40-24v-48l-40 24z" fill="${BRAND_LIGHT}" stroke="${BRAND}" stroke-width="2"/>
      <text x="168" y="140" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="${SLATE}">${escXml(title.slice(0, 28))}</text>
      <rect x="168" y="160" width="360" height="8" rx="4" fill="#E2E8F0"/>
      <rect x="168" y="180" width="300" height="8" rx="4" fill="#E2E8F0"/>
      <text x="168" y="230" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Encrypted · access controlled</text>`);
  },
  'getting-started'(slug, title) {
    if (slug.includes('upload') || slug.includes('paste')) {
      return shell(title.slice(0, 36), `
        ${card(48, 80, 300, 260, true)}
        <text x="72" y="112" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${SLATE}">Video source</text>
        <rect x="72" y="128" width="252" height="100" rx="8" fill="${BRAND_LIGHT}" stroke="#C7D2FE" stroke-dasharray="6 4"/>
        <text x="88" y="188" font-family="system-ui,sans-serif" font-size="11" fill="${BRAND}">Link or file</text>
        ${btn(72, 220, 120, 'Transcribe')}
        ${card(368, 80, 304, 260)}
        ${progress(392, 140, 240, 0.55)}
        <text x="392" y="180" font-family="system-ui,sans-serif" font-size="11" fill="${MUTED}">Processing…</text>`);
    }
    return shell(title.slice(0, 36), `${sidebar()}
      ${card(192, 80, 480, 260, true)}
      <text x="216" y="118" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${SLATE}">${escXml(title.slice(0, 32))}</text>
      ${progress(216, 150, 400, 0.5)}
      ${btn(216, 200, 140, 'Get started')}`);
  },
};

function defaultBuilder(slug, category, title) {
  const fn = categoryTemplates[category];
  if (fn) return fn(slug, title);
  return shell(title.slice(0, 40), `
    ${card(120, 100, 480, 200, true)}
    <text x="144" y="140" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="${SLATE}">${escXml(title.slice(0, 40))}</text>
    ${progress(144, 170, 400, 0.6)}
    ${btn(144, 220, 140, 'Open guide')}`);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

for (const art of HELP_ARTICLES) {
  const fn = builders[art.slug] || (() => defaultBuilder(art.slug, art.category_slug, art.title));
  const svg = typeof fn === 'function' ? fn() : fn;
  writeFileSync(join(OUT, `${art.slug}.svg`), svg, 'utf8');
}

console.log(`Generated ${HELP_ARTICLES.length} article illustrations in ${OUT}`);
