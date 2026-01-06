import { OAuth2Client } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://cutup.shop/api/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://cutup.shop';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if Google OAuth is configured
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('[oauth-google-start] Google OAuth not configured');
    return res.status(500).json({ 
      error: 'Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' 
    });
  }

  try {
    // Initialize OAuth client
    const oAuth2Client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    // Generate Google OAuth URL
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      prompt: 'consent',
      include_granted_scopes: true
    });

    console.log('[oauth-google-start] Generated auth URL successfully');
    console.log('[oauth-google-start] Redirect URI:', GOOGLE_REDIRECT_URI);
    console.log('[oauth-google-start] Client ID:', GOOGLE_CLIENT_ID ? 'Set' : 'Missing');

    return res.status(200).json({ authUrl });
  } catch (error) {
    console.error('[oauth-google-start] Error generating auth URL:', error);
    return res.status(500).json({ 
      error: 'Failed to generate Google OAuth URL',
      details: error.message 
    });
  }
}

