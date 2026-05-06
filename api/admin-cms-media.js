/**
 * POST /api/admin/cms/media — multipart upload for Content Studio library
 */
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import { randomBytes } from 'crypto';
import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { insertCmsMediaDb } from './admin-cms-repository.js';
import { guardCmsAction, cmsSetupPayload, isCmsSetupError } from './cms-bootstrap.js';
import { mediaSubfolderForType } from './admin-cms-media-sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CMS_MEDIA_DIR = join(__dirname, '..', 'website', 'cms-media');
const MAX_BYTES = 50 * 1024 * 1024;

const MIME_MAP = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'application/pdf': 'document'
};

function requireBlogAccess(auth, res) {
  const role = auth?.role || '';
  if (!['editor', 'admin', 'super_admin'].includes(role)) {
    res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to manage media.' });
    return false;
  }
  return true;
}

function safeExt(name, mime) {
  const ext = extname(String(name || '')).toLowerCase();
  if (ext && ext.length <= 8) return ext;
  if (mime?.includes('jpeg')) return '.jpg';
  if (mime?.includes('png')) return '.png';
  if (mime?.includes('webp')) return '.webp';
  if (mime?.includes('pdf')) return '.pdf';
  if (mime?.includes('mp4')) return '.mp4';
  if (mime?.includes('mpeg')) return '.mp3';
  return '';
}

function ensureSubdir(subfolder) {
  const dir = join(CMS_MEDIA_DIR, subfolder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export default async function handler(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await resolveAdminAuth(req);
  if (!auth) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      message: 'Your session expired. Please sign in again.'
    });
  }
  if (!requireBlogAccess(auth, res)) return;

  const guard = await guardCmsAction('cmsMedia');
  if (guard.blocked) return res.status(200).json(guard.body);

  if (!existsSync(CMS_MEDIA_DIR)) mkdirSync(CMS_MEDIA_DIR, { recursive: true });

  const folderHint = String(req.query?.folder || req.headers['x-cms-folder'] || '').trim();

  return new Promise((resolve) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES } });
    let filePromise = null;

    busboy.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      const mediaType = MIME_MAP[mimeType] || 'document';
      const subfolder = mediaSubfolderForType(mediaType, folderHint);
      const ext = safeExt(filename, mimeType) || '.bin';
      const storedBase = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
      const stored = `${subfolder}/${storedBase}`;
      const destDir = ensureSubdir(subfolder);
      const dest = join(destDir, storedBase);
      let size = 0;

      filePromise = new Promise((resFile, rejFile) => {
        const out = createWriteStream(dest);
        stream.on('data', (chunk) => {
          size += chunk.length;
        });
        stream.pipe(out);
        out.on('finish', () =>
          resFile({
            stored,
            filename,
            mimeType,
            mediaType,
            size,
            dest,
            subfolder
          })
        );
        out.on('error', rejFile);
        stream.on('error', rejFile);
      });
    });

    busboy.on('error', (err) => {
      res.status(400).json({
        error: 'upload_failed',
        message: err.message || 'Upload failed. Please try again.'
      });
      resolve();
    });

    busboy.on('finish', async () => {
      try {
        if (!filePromise) {
          res.status(400).json({ error: 'No file uploaded', message: 'Choose a file to upload.' });
          return resolve();
        }
        const f = await filePromise;
        const url = `/cms-media/${f.stored.split('/').map(encodeURIComponent).join('/')}`;
        const id = await insertCmsMediaDb({
          filename: f.stored,
          originalName: f.filename || f.stored,
          mimeType: f.mimeType || 'application/octet-stream',
          mediaType: f.mediaType,
          fileSize: f.size,
          url,
          folder: f.subfolder,
          tags: folderHint ? [folderHint] : [],
          uploadedBy: auth.email || ''
        });
        const file = {
          id,
          url,
          filename: f.stored,
          originalName: f.filename,
          mimeType: f.mimeType,
          mediaType: f.mediaType,
          fileSize: f.size,
          folder: f.subfolder
        };
        res.status(200).json({ ok: true, success: true, id, file, media: file });
      } catch (e) {
        console.error('[cms-media]', e);
        if (isCmsSetupError(e)) {
          res.status(200).json(cmsSetupPayload({ missingTables: ['media_library'] }));
          return resolve();
        }
        res.status(500).json({
          error: 'Upload failed',
          message: 'Upload failed. Please try again.'
        });
      }
      resolve();
    });

    req.pipe(busboy);
  });
}
