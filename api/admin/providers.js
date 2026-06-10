/**
 * GET /api/admin/providers — transcription provider registry + health (admin or internal key).
 */
import { setCORSHeaders } from '../cors.js';
import { resolveAdminAuth } from '../admin-panel-auth.js';
import { ensureTranscriptionProvidersInit, getTranscriptionEnvStatus, getTranscriptionProviderRegistry } from '../transcription/init.js';
import {
  TRANSCRIPTION_PROVIDER_ORDER,
  isTranscriptionProviderConfigured
} from '../transcription/registry.js';
import { TRANSCRIPTION_PROVIDER_MODELS } from '../transcription/provider-ids.js';
import { getProviderHealthSnapshot } from '../transcription/provider-health.js';

function canAccess(req, auth) {
  if (auth) {
    const r = String(auth.role || '').toLowerCase();
    if (r === 'super_admin' || r === 'admin') return true;
  }
  const secret = String(process.env.INTERNAL_DIAG_KEY || process.env.ADMIN_INTERNAL_TOKEN || '').trim();
  if (secret && req.headers['x-internal-diag-key'] === secret) return true;
  if (process.env.ADMIN_DEBUG === 'true' && req.headers['x-admin-debug'] === '1') return true;
  return false;
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = await resolveAdminAuth(req);
  if (!canAccess(req, auth)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Admin session or x-internal-diag-key required.'
    });
  }

  ensureTranscriptionProvidersInit();
  const reg = getTranscriptionProviderRegistry();
  const env = getTranscriptionEnvStatus();

  return res.status(200).json({
    primaryProviderId: reg.primaryProviderId,
    primaryModel: reg.primaryModel,
    activeProviders: [...reg.activeProviders],
    fallbackProviders: [...reg.fallbackProviders],
    fallbackOrder: [...reg.fallbackOrder],
    configuredOrder: TRANSCRIPTION_PROVIDER_ORDER.map((id) => ({
      id,
      model: TRANSCRIPTION_PROVIDER_MODELS[id] || null,
      configured: isTranscriptionProviderConfigured(id)
    })),
    env: {
      openai: env.openai,
      groq: env.groq,
      deepgram: env.deepgram,
      localWhisper: env.localWhisper
    },
    health: getProviderHealthSnapshot()
  });
}
