/**
 * Temporary diagnostics for admin email preview pipeline.
 * Does not modify templates — probes bundle on disk and annotates rendered HTML.
 */
import { readFileSync, statSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, 'email-platform', 'index.js');
const STAMP_PATH = join(__dirname, 'email-platform', 'BUILD_STAMP.json');

export const EMAIL_TEMPLATE_VERSION = 'V3.1';

export const TEMPLATE_SOURCE_PATHS = {
  WELCOME_EMAIL: 'emails/templates/WelcomeEmail.tsx',
  EXPORT_COMPLETED: 'emails/templates/ExportCompleted.tsx',
  PAYMENT_RECEIPT: 'emails/templates/PaymentReceipt.tsx',
  SUBSCRIPTION_UPGRADED: 'emails/templates/SubscriptionUpgraded.tsx',
  USAGE_WARNING_80: 'emails/templates/UsageWarning80.tsx',
  USAGE_WARNING_100: 'emails/templates/UsageWarning100.tsx',
  ACCOUNT_DELETION_REQUESTED: 'emails/templates/AccountDeletionRequested.tsx',
  ACCOUNT_DELETION_COMPLETED: 'emails/templates/AccountDeletionCompleted.tsx',
  SUPPORT_TICKET_CREATED: 'emails/templates/SupportTicketCreated.tsx',
  SUPPORT_TICKET_REPLY: 'emails/templates/SupportTicketReply.tsx',
  SUPPORT_TICKET_RESOLVED: 'emails/templates/SupportTicketResolved.tsx',
  SUPPORT_TICKET_CLOSED: 'emails/templates/SupportTicketClosed.tsx',
  SECURITY_NOTIFICATION: 'emails/templates/SecurityNotification.tsx',
  SYSTEM_NOTIFICATION: 'emails/templates/SystemNotification.tsx',
};

function readBuildStamp() {
  try {
    if (!existsSync(STAMP_PATH)) return null;
    return JSON.parse(readFileSync(STAMP_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function probeBundleOnDisk() {
  const out = {
    bundlePath: 'api/email-platform/index.js',
    bundleExists: false,
    bundleMtime: null,
    bundleSize: null,
    heroTitleSizeInBundle: null,
    hasFaqInBundle: false,
    hasManageNotificationsInBundle: false,
    hasPrivacyHtmlInBundle: false,
  };
  try {
    if (!existsSync(BUNDLE_PATH)) return out;
    const st = statSync(BUNDLE_PATH);
    const raw = readFileSync(BUNDLE_PATH, 'utf8');
    out.bundleExists = true;
    out.bundleMtime = st.mtime.toISOString();
    out.bundleSize = st.size;
    out.heroTitleSizeInBundle = raw.match(/heroTitleSize:\s*"([^"]+)"/)?.[1] || null;
    out.hasFaqInBundle = raw.includes('faqUrl') && raw.includes('"FAQ"');
    out.hasManageNotificationsInBundle = raw.includes('Manage Notifications');
    out.hasPrivacyHtmlInBundle = raw.includes('privacy.html');
  } catch (err) {
    out.probeError = err?.message || String(err);
  }
  return out;
}

function probeRenderedHtml(html) {
  const text = String(html || '');
  return {
    htmlLength: text.length,
    hasFaqInHtml: text.includes('>FAQ<') || text.includes('>FAQ</'),
    hasManageNotificationsInHtml: text.includes('Manage Notifications'),
    hasPrivacyHtmlInHtml: text.includes('privacy.html'),
    heroCssSizeInHtml: text.match(/\.email-hero-title\s*\{\s*font-size:\s*([^!]+)/)?.[1]?.trim() || null,
    hasDebugMarker: text.includes('data-cutup-email-debug'),
  };
}

export function buildPreviewDiagnostics(templateId, html) {
  const stamp = readBuildStamp();
  const bundle = probeBundleOnDisk();
  const rendered = probeRenderedHtml(html);
  const source = TEMPLATE_SOURCE_PATHS[templateId] || `emails/templates/${templateId}.tsx`;
  const renderedAt = new Date().toISOString();

  const bundleMatchesHtml =
    bundle.heroTitleSizeInBundle &&
    rendered.heroCssSizeInHtml &&
    bundle.heroTitleSizeInBundle === rendered.heroCssSizeInHtml.replace(/!important/g, '').trim();

  const suspectedStaleModuleCache =
    bundle.bundleExists &&
    rendered.htmlLength > 0 &&
    bundle.hasFaqInBundle &&
    !rendered.hasFaqInHtml;

  return {
    templateVersion: EMAIL_TEMPLATE_VERSION,
    renderedAt,
    template: templateId,
    source,
    renderer: '@react-email/render via api/email-platform/index.js (esbuild bundle)',
    buildSource: 'services/email/runtime-entry.ts → npm run build:emails',
    buildStamp: stamp,
    bundle,
    rendered,
    pipeline: [
      'adminha.html → admin-email-preview.js',
      'GET /api/admin/email-preview?template=…',
      'api/admin-email-preview.js',
      'api/email-events-bus.js → import(email-platform/index.js)',
      'renderEmailTemplate() in bundled services/email/render.ts',
    ],
    cache: {
      apiResponseCached: false,
      dbHtmlStored: false,
      staticHtmlSnapshot: false,
      browserIframeSrcdoc: 'fresh each Refresh preview click',
      nodeModuleImportCache: 'email-events-bus platformPromise caches first import until process restart',
      suspectedStaleModuleCache,
      bundleMatchesHtml,
    },
  };
}

export function injectPreviewDiagnostics(html, diagnostics) {
  const text = String(html || '');
  if (!text) return text;

  const d = diagnostics;
  const banner =
    '<div data-cutup-email-debug="1" style="margin:16px auto 0;max-width:600px;padding:12px 16px;' +
    'border:2px dashed #f59e0b;border-radius:8px;background:#fffbeb;font-family:monospace;font-size:11px;' +
    'line-height:1.5;color:#92400e;text-align:left;">' +
    '<strong style="display:block;margin-bottom:6px;color:#b45309;">⚙ Cutup Email Preview Debug</strong>' +
    `Template Version: ${d.templateVersion}<br/>` +
    `Rendered At: ${d.renderedAt}<br/>` +
    `Source: ${d.source}<br/>` +
    `Renderer: ${d.renderer}<br/>` +
    `Build: ${d.buildSource}<br/>` +
    `Bundle mtime: ${d.bundle.bundleMtime || 'missing'} · size: ${d.bundle.bundleSize ?? '—'}<br/>` +
    `Build stamp: ${d.buildStamp?.builtAt || 'no BUILD_STAMP.json — run npm run build:emails'}<br/>` +
    `Bundle heroTitleSize: ${d.bundle.heroTitleSizeInBundle || '—'} · HTML CSS: ${d.rendered.heroCssSizeInHtml || '—'}<br/>` +
    `FAQ in bundle/html: ${d.bundle.hasFaqInBundle}/${d.rendered.hasFaqInHtml} · ` +
    `ManageNotif in bundle/html: ${d.bundle.hasManageNotificationsInBundle}/${d.rendered.hasManageNotificationsInHtml}<br/>` +
    (d.cache.suspectedStaleModuleCache
      ? '<strong style="color:#dc2626;">⚠ Stale Node module cache likely — restart server after build:emails</strong>'
      : '') +
    '</div>';

  if (text.includes('</body>')) {
    return text.replace('</body>', banner + '</body>');
  }
  return text + banner;
}
