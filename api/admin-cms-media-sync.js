/**
 * Content Studio — scan website assets and index into media_library
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getPool, isBillingDbConfigured } from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = join(__dirname, '..', 'website');

const MEDIA_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico', '.avif',
  '.mp4', '.webm', '.mov',
  '.mp3', '.wav', '.ogg', '.m4a',
  '.pdf', '.doc', '.docx'
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'tools']);

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf'
};

const SCAN_ROOTS = [
  { rel: 'cms-media', urlBase: '/cms-media' },
  { rel: 'public', urlBase: '' },
  { rel: 'assets', urlBase: '/assets' },
  { rel: 'icons', urlBase: '/icons' },
  { rel: 'uploads', urlBase: '/uploads' }
];

const ROOT_ASSETS = ['logo.svg', 'logo-footer.svg', 'niran-logo.png', 'favicon.svg', 'google-g.svg'];

function mediaTypeFromMime(mime, ext) {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'document';
  if (['.svg', '.ico'].includes(ext)) return 'image';
  return 'document';
}

function inferFolder(relPath, url, mediaType) {
  const lower = `${relPath} ${url}`.toLowerCase();
  if (lower.includes('/blog/') || lower.includes('blog-cover')) return 'blog';
  if (lower.includes('/generated/') || lower.includes('thumb')) return 'generated';
  if (lower.includes('logo') || lower.includes('/icons/')) return 'logos';
  if (lower.includes('/images/')) return 'images';
  if (lower.includes('/videos/')) return 'videos';
  if (lower.includes('/audio/')) return 'audio';
  if (lower.includes('/documents/')) return 'documents';
  if (mediaType === 'image') return 'images';
  if (mediaType === 'video') return 'videos';
  if (mediaType === 'audio') return 'audio';
  return 'assets';
}

function inferTags(relPath, url) {
  const tags = [];
  const lower = `${relPath} ${url}`.toLowerCase();
  if (lower.includes('logo')) tags.push('logo');
  if (lower.includes('og') || lower.includes('open-graph')) tags.push('og');
  if (lower.includes('cover')) tags.push('cover');
  if (lower.includes('thumb')) tags.push('thumbnail');
  if (lower.includes('/icons/')) tags.push('icon');
  return tags;
}

function encodeUrlPath(segments) {
  return segments.filter(Boolean).map((s) => encodeURIComponent(s)).join('/');
}

function buildUrl(urlBase, scanRootRel, fullRel) {
  const prefix = scanRootRel ? `${scanRootRel}/` : '';
  const sub = fullRel.startsWith(prefix) ? fullRel.slice(prefix.length) : fullRel;
  const encoded = encodeUrlPath(sub.split('/'));
  if (!urlBase) return `/${encoded}`;
  return `${urlBase.replace(/\/$/, '')}/${encoded}`;
}

async function findMediaByUrl(url) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query('SELECT id FROM media_library WHERE url = $1 LIMIT 1', [url]);
  return r.rows[0]?.id ? String(r.rows[0].id) : null;
}

async function upsertScannedFile({ absPath, url, relPath, uploadedBy = 'system-sync' }) {
  if (!isBillingDbConfigured()) return { action: 'skip' };
  const ext = extname(absPath).toLowerCase();
  if (!MEDIA_EXT.has(ext)) return { action: 'skip' };

  const stat = statSync(absPath);
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  const mediaType = mediaTypeFromMime(mime, ext);
  const folder = inferFolder(relPath, url, mediaType);
  const tags = inferTags(relPath, url);
  const filename = relPath.replace(/^cms-media\//, '') || basename(absPath);
  const originalName = basename(absPath);

  const existingId = await findMediaByUrl(url);
  const pool = getPool();

  if (existingId) {
    await pool.query(
      `UPDATE media_library SET
        file_size = $2,
        folder = COALESCE(folder, $3),
        tags = CASE WHEN array_length(tags, 1) IS NULL OR array_length(tags, 1) = 0 THEN $4 ELSE tags END,
        updated_at = NOW()
       WHERE id = $1::bigint`,
      [existingId, stat.size, folder, tags]
    );
    return { action: 'updated', id: existingId };
  }

  const r = await pool.query(
    `INSERT INTO media_library
      (filename, original_name, mime_type, media_type, file_size, url, alt_text, folder, tags, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9) RETURNING id`,
    [filename, originalName, mime, mediaType, stat.size, url, folder, tags, uploadedBy]
  );
  return { action: 'inserted', id: String(r.rows[0].id) };
}

function scanDirectory(scanRootRel, urlBase, onFile) {
  const absRoot = join(WEBSITE_ROOT, scanRootRel);
  if (!existsSync(absRoot)) return;

  function walk(currentAbs, currentRel) {
    let entries;
    try {
      entries = readdirSync(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const childRel = currentRel ? `${currentRel}/${ent.name}` : ent.name;
      const childAbs = join(currentAbs, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(childAbs, childRel);
        continue;
      }
      const ext = extname(ent.name).toLowerCase();
      if (!MEDIA_EXT.has(ext)) continue;
      onFile({
        absPath: childAbs,
        url: buildUrl(urlBase, scanRootRel, childRel),
        relPath: childRel
      });
    }
  }

  walk(absRoot, scanRootRel);
}

async function indexReferencedUrls(uploadedBy) {
  if (!isBillingDbConfigured()) return { inserted: 0, updated: 0 };
  const pool = getPool();
  let inserted = 0;
  let updated = 0;
  const urls = new Set();

  try {
    const blog = await pool.query(
      `SELECT cover_image_url AS u FROM blog_posts WHERE cover_image_url IS NOT NULL AND cover_image_url <> ''`
    );
    blog.rows.forEach((r) => urls.add(r.u));
  } catch { /* optional */ }

  try {
    const pages = await pool.query(
      `SELECT og_image_url AS u FROM cms_pages WHERE og_image_url IS NOT NULL AND og_image_url <> ''`
    );
    pages.rows.forEach((r) => urls.add(r.u));
  } catch { /* optional */ }

  for (const rawUrl of urls) {
    const url = String(rawUrl).trim();
    if (!url || url.startsWith('http')) continue;
    const pathPart = url.startsWith('/') ? url.slice(1) : url;
    const abs = join(WEBSITE_ROOT, pathPart);
    if (!existsSync(abs)) {
      const existingId = await findMediaByUrl(url.startsWith('/') ? url : `/${url}`);
      if (!existingId) {
        const ext = extname(pathPart).toLowerCase();
        if (!MEDIA_EXT.has(ext)) continue;
        const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
        const mediaType = mediaTypeFromMime(mime, ext);
        const pool2 = getPool();
        await pool2.query(
          `INSERT INTO media_library
            (filename, original_name, mime_type, media_type, file_size, url, folder, tags, uploaded_by)
           VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8)`,
          [
            pathPart,
            basename(pathPart),
            mime,
            mediaType,
            url.startsWith('/') ? url : `/${url}`,
            url.includes('blog') ? 'blog' : 'images',
            ['referenced'],
            uploadedBy
          ]
        );
        inserted++;
      }
      continue;
    }
    const result = await upsertScannedFile({
      absPath: abs,
      url: url.startsWith('/') ? url : `/${url}`,
      relPath: pathPart,
      uploadedBy
    });
    if (result.action === 'inserted') inserted++;
    if (result.action === 'updated') updated++;
  }
  return { inserted, updated };
}

export async function syncCmsMediaLibrary(opts = {}) {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured', scanned: 0, inserted: 0, updated: 0, skipped: 0 };
  }

  const uploadedBy = opts.uploadedBy || 'system-sync';
  let scanned = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const files = [];
  for (const { rel, urlBase } of SCAN_ROOTS) {
    scanDirectory(rel, urlBase, (f) => files.push(f));
  }
  for (const name of ROOT_ASSETS) {
    const abs = join(WEBSITE_ROOT, name);
    if (existsSync(abs)) {
      files.push({ absPath: abs, url: `/${name}`, relPath: name });
    }
  }

  for (const file of files) {
    scanned++;
    try {
      const result = await upsertScannedFile({ ...file, uploadedBy });
      if (result.action === 'inserted') inserted++;
      else if (result.action === 'updated') updated++;
      else skipped++;
    } catch (e) {
      console.warn('[cms-media-sync] skip', file.relPath, e.message);
      skipped++;
    }
  }

  const ref = await indexReferencedUrls(uploadedBy);
  inserted += ref.inserted || 0;
  updated += ref.updated || 0;

  return { ok: true, scanned, inserted, updated, skipped, total: scanned };
}

export function mediaSubfolderForType(mediaType, hint = '') {
  if (hint === 'blog' || hint === 'cover') return 'blog';
  if (hint === 'generated') return 'generated';
  const map = {
    image: 'images',
    video: 'videos',
    audio: 'audio',
    document: 'documents'
  };
  return map[mediaType] || 'assets';
}
