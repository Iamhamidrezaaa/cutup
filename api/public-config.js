import { setCORSHeaders } from './cors.js';
import { isRtlLanguagesEnabled } from './rtl-languages-feature.js';

export default async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  return res.status(200).json({
    enableRtlLanguages: isRtlLanguagesEnabled()
  });
}
