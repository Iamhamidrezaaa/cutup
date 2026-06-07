/** Cutup email brand tokens — V2 enterprise design system. */
export const BRAND = {
  primary: '#635BFF',
  primaryDark: '#4F46E5',
  primaryLight: '#8B85FF',
  gradient: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)',
  text: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  background: '#F8FAFC',
  card: '#FFFFFF',
  surface: '#F1F5F9',
  border: '#E5E7EB',
  success: '#10B981',
  successBg: '#ECFDF5',
  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  danger: '#EF4444',
  dangerBg: '#FEF2F2',
  info: '#3B82F6',
  infoBg: '#EFF6FF',
  radius: '12px',
  radiusLg: '20px',
  shadowSm: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  maxWidth: '640px',
} as const;

export const PLAN_COLORS: Record<string, { bg: string; text: string }> = {
  starter: { bg: '#F1F5F9', text: '#475569' },
  free: { bg: '#F1F5F9', text: '#475569' },
  pro: { bg: '#EEF2FF', text: '#4338CA' },
  business: { bg: '#FDF4FF', text: '#7E22CE' },
  enterprise: { bg: '#ECFEFF', text: '#0E7490' },
};

export const SITE = {
  name: 'Cutup',
  tagline: 'AI-Powered Video Workspace',
  url: (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, ''),
  supportEmail: 'support@cutup.shop',
  privacyUrl: 'https://cutup.shop/privacy',
  termsUrl: 'https://cutup.shop/terms',
  notificationsUrl: 'https://cutup.shop/dashboard.html#notifications',
  dashboardUrl: 'https://cutup.shop/dashboard.html',
  logoUrl: 'https://cutup.shop/logo.svg',
} as const;
