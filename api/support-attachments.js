/**
 * POST /api/support/attachments — multipart upload for ticket messages
 */
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import { randomBytes } from 'crypto';
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getUserIdByEmail, isBillingDbConfigured } from './billing-repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ATTACH_DIR = join(__dirname, '..', 'website', 'support-attachments');
const MAX_BYTES = 3 * 1024 * 1024;

const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.heif', '.heic']);

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/octet-stream',
]);

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

async function resolveUser(req, res) {
  setCORSHeaders(res);
  if (!isBillingDbConfigured()) {
    res.status(503).json({ ok: false, error: 'db_not_configured' });
    return null;
  }
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    res.status(401).json({ ok: false, error: 'no_session' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session?.user?.email) {
    res.status(401).json({ ok: false, error: 'invalid_session' });
    return null;
  }
  const userId = await getUserIdByEmail(session.user.email);
  if (!userId) {
    res.status(404).json({ ok: false, error: 'user_not_found' });
    return null;
  }
  return { userId: String(userId) };
}

function safeExt(name, mime) {
  const ext = extname(String(name || '')).toLowerCase();
  if (ALLOWED_EXT.has(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return MIME_EXT[mime] || '';
}

function isAllowedUpload(filename, mime) {
  const ext = safeExt(filename, mime);
  if (!ext || !ALLOWED_EXT.has(ext === '.jpg' ? '.jpg' : ext)) return false;
  if (mime && mime !== 'application/octet-stream' && !ALLOWED_MIME.has(mime)) {
    return ext === '.heic' || ext === '.heif' || ext === '.jpg' || ext === '.png' || ext === '.pdf';
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCORSHeaders(res);
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const user = await resolveUser(req, res);
  if (!user) return;

  if (!existsSync(ATTACH_DIR)) mkdirSync(ATTACH_DIR, { recursive: true });

  return new Promise((resolve) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_BYTES, files: 1 },
    });

    let uploaded = null;
    let fileTooLarge = false;
    let rejectedType = false;
    let writeDone = Promise.resolve();
    let partialPath = null;

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const mime = mimeType || 'application/octet-stream';
      if (!isAllowedUpload(filename, mime)) {
        rejectedType = true;
        file.resume();
        return;
      }
      const ext = safeExt(filename, mime);
      const stored = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
      const dest = join(ATTACH_DIR, stored);
      partialPath = dest;
      let size = 0;
      const ws = createWriteStream(dest);

      writeDone = new Promise((resolveWrite, rejectWrite) => {
        file.on('data', (chunk) => {
          size += chunk.length;
        });
        file.on('limit', () => {
          fileTooLarge = true;
          ws.destroy();
        });
        ws.on('error', rejectWrite);
        ws.on('finish', () => {
          if (!fileTooLarge) {
            uploaded = {
              filename: String(filename || stored),
              size,
              mime: mime === 'application/octet-stream' ? (ext === '.pdf' ? 'application/pdf' : `image/${ext.replace('.', '')}`) : mime,
              url: `/support-attachments/${stored}`,
              uploaded_at: new Date().toISOString(),
            };
          }
          resolveWrite();
        });
      });

      file.pipe(ws);
    });

    busboy.on('error', (err) => {
      console.error('[support-attachments]', err);
      if (partialPath && existsSync(partialPath)) {
        try { unlinkSync(partialPath); } catch (_e) { /* noop */ }
      }
      res.status(400).json({ ok: false, error: 'upload_failed' });
      resolve();
    });

    busboy.on('finish', async () => {
      try {
        await writeDone;
      } catch (err) {
        console.error('[support-attachments] write failed', err);
        res.status(400).json({ ok: false, error: 'upload_failed' });
        resolve();
        return;
      }

      if (fileTooLarge) {
        if (partialPath && existsSync(partialPath)) {
          try { unlinkSync(partialPath); } catch (_e) { /* noop */ }
        }
        res.status(413).json({ ok: false, error: 'file_too_large', maxBytes: MAX_BYTES });
        resolve();
        return;
      }
      if (rejectedType || !uploaded) {
        if (partialPath && existsSync(partialPath)) {
          try { unlinkSync(partialPath); } catch (_e) { /* noop */ }
        }
        res.status(400).json({ ok: false, error: 'invalid_file_type', allowed: ['pdf', 'jpg', 'jpeg', 'png', 'heif', 'heic'] });
        resolve();
        return;
      }
      res.json({ ok: true, attachment: uploaded });
      resolve();
    });

    req.pipe(busboy);
  });
}
