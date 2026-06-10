/**
 * POST /api/debug/raw-asr — return provider output exactly (ASR V2, no mutations).
 * Protected by INTERNAL_DIAG_KEY or admin session.
 */
import Busboy from 'busboy';
import fetchModule from 'node-fetch';
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { prepareUploadBufferForTranscription } from './upload-media-prep.js';
import {
  transcribeAsrV2,
  formatRawAsrDebugPayload,
  getAsrPipelineVersion,
  preserveProviderOutput
} from './transcription/transcription-v2.js';
import { applyV1PostProcessing } from './transcription/asr-v1-postprocess.js';
import { buildV1V2ComparisonReport } from './transcription/asr-pipeline-comparison.js';

const MAX_BYTES = 100 * 1024 * 1024;

function getFetch() {
  return fetchModule.default || fetchModule;
}

async function authorizeDebug(req) {
  const admin = await resolveAdminAuth(req);
  if (admin?.ok) return true;
  const secret = String(process.env.INTERNAL_DIAG_KEY || process.env.ADMIN_INTERNAL_TOKEN || '').trim();
  if (!secret) return false;
  const header = String(req.headers['x-internal-diag-key'] || req.headers['x-admin-internal-token'] || '').trim();
  return header === secret;
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!(await authorizeDebug(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const traceId = req.headers['x-trace-id'] || `raw-asr-${Date.now()}`;
  const compareV1 = String(req.query?.compare || req.headers['x-asr-compare'] || '').toLowerCase() === 'v1';

  return new Promise((resolve) => {
    const busboy = Busboy({ headers: req.headers });
    const chunks = [];
    let filename = 'audio';
    let mimeType = 'application/octet-stream';
    let languageHint = null;

    busboy.on('file', (_name, file, info) => {
      filename = info?.filename || filename;
      mimeType = info?.mimeType || mimeType;
      file.on('data', (d) => chunks.push(d));
    });

    busboy.on('field', (name, val) => {
      if (name === 'language' || name === 'languageHint') languageHint = val || null;
    });

    busboy.on('finish', async () => {
      try {
        let audioBuffer = Buffer.concat(chunks);
        if (!audioBuffer.length) {
          res.status(400).json({ error: 'no_file' });
          return resolve();
        }
        if (audioBuffer.length > MAX_BYTES) {
          res.status(400).json({ error: 'file_too_large', maxMb: 100 });
          return resolve();
        }

        const prepared = await prepareUploadBufferForTranscription(audioBuffer, mimeType, filename, traceId);
        audioBuffer = prepared.buffer;
        mimeType = prepared.mimeType;
        const extension = prepared.extension;

        const fetch = getFetch();
        const v2Result = await transcribeAsrV2({
          fetch,
          traceId,
          audioBuffer,
          mimeType,
          extension,
          languageHint
        });

        const payload = {
          traceId,
          asrPipeline: getAsrPipelineVersion(),
          ...formatRawAsrDebugPayload(v2Result)
        };

        if (compareV1) {
          const v1Input = preserveProviderOutput(v2Result, v2Result.provider);
          const v1Processed = await applyV1PostProcessing({
            transcript: { ...v1Input, provider: v2Result.provider },
            traceId
          });
          payload.comparison = buildV1V2ComparisonReport(v1Processed, v2Result);
        }

        res.status(200).json(payload);
      } catch (err) {
        console.error('[debug-raw-asr]', traceId, err?.message || err);
        res.status(500).json({
          error: 'raw_asr_failed',
          message: String(err?.message || err).slice(0, 300),
          traceId
        });
      }
      resolve();
    });

    busboy.on('error', (err) => {
      res.status(400).json({ error: 'parse_error', message: err?.message });
      resolve();
    });

    req.pipe(busboy);
  });
}
