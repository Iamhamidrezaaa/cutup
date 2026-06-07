/**
 * POST /api/support/attachments — multipart upload for ticket messages
 */
import { createWriteStream, existsSync, mkdirSync } from 'fs';
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
const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
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
  if (['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.zip'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return MIME_EXT[mime] || '';
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

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const mime = mimeType || 'application/octet-stream';
      if (!ALLOWED_MIME.has(mime)) {
        file.resume();
        return;
      }
      const ext = safeExt(filename, mime);
      const stored = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
      const dest = join(ATTACH_DIR, stored);
      let size = 0;
      const ws = createWriteStream(dest);

      file.on('data', (chunk) => {
        size += chunk.length;
      });
      file.on('limit', () => {
        fileTooLarge = true;
        ws.destroy();
      });
      file.pipe(ws);

      ws.on('finish', () => {
        if (!fileTooLarge) {
          uploaded = {
            filename: String(filename || stored),
            size,
            mime,
            url: `/support-attachments/${stored}`,
            uploaded_at: new Date().toISOString(),
          };
        }
      });
    });

    busboy.on('error', (err) => {
      console.error('[support-attachments]', err);
      res.status(400).json({ ok: false, error: 'upload_failed' });
      resolve();
    });

    busboy.on('finish', () => {
      if (fileTooLarge) {
        res.status(413).json({ ok: false, error: 'file_too_large', maxBytes: MAX_BYTES });
        resolve();
        return;
      }
      if (!uploaded) {
        res.status(400).json({ ok: false, error: 'invalid_file_type' });
        resolve();
        return;
      }
      res.json({ ok: true, attachment: uploaded });
      resolve();
    });

    req.pipe(busboy);
  });
}
