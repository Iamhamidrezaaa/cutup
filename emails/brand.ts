/** Cutup email brand tokens — single source for React Email templates. */
export const BRAND = {
  primary: '#635BFF',
  primaryDark: '#4F46E5',
  text: '#111827',
  textMuted: '#6B7280',
  textSubtle: '#9CA3AF',
  background: '#FFFFFF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  radius: '12px',
  radiusLg: '16px',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

export const SITE = {
  name: 'Cutup',
  tagline: 'AI Video Workspace',
  url: (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, ''),
  supportEmail: 'support@cutup.shop',
  privacyUrl: 'https://cutup.shop/privacy',
  termsUrl: 'https://cutup.shop/terms',
  dashboardUrl: 'https://cutup.shop/dashboard.html',
} as const;
