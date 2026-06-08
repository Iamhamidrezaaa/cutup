/** Cutup email brand tokens — V3 desktop-first, Gmail-safe mobile. */
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
  shadowButton: '0 4px 14px rgba(99, 91, 255, 0.28)',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  maxWidth: '600px',
  padX: '36px',
  padXMobile: '20px',
  padBody: '44px 36px',
  padBodyMobile: '28px 20px',
  heroTitleSize: '48px',
  heroTitleSizeMobile: '32px',
  bodySize: '16px',
  metaSize: '14px',
  buttonMaxWidth: '320px',
  cardPad: '24px',
  cardPadMobile: '18px',
  cardMarginBottom: '24px',
  heroPadTop: '40px',
  heroPadBottom: '32px',
  detailWrapPad: '16px',
} as const;

export const PLAN_COLORS: Record<string, { bg: string; text: string }> = {
  starter: { bg: '#F1F5F9', text: '#475569' },
  free: { bg: '#F1F5F9', text: '#475569' },
  pro: { bg: '#EEF2FF', text: '#4338CA' },
  business: { bg: '#FDF4FF', text: '#7E22CE' },
  enterprise: { bg: '#ECFEFF', text: '#0E7490' },
};

const SITE_ORIGIN = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

function goLink(params: Record<string, string>) {
  const q = new URLSearchParams(params);
  return `${SITE_ORIGIN}/go.html?${q.toString()}`;
}

export const SITE = {
  name: 'Cutup',
  tagline: 'AI-Powered Video Workspace',
  url: SITE_ORIGIN,
  supportEmail: 'support@cutup.shop',
  privacyUrl: `${SITE_ORIGIN}/privacy`,
  termsUrl: `${SITE_ORIGIN}/terms`,
  notificationsUrl: goLink({ dest: 'notifications' }),
  dashboardUrl: goLink({ dest: 'dashboard' }),
  logoUrl: `${SITE_ORIGIN}/logo.svg`,
  supportTicketUrl: (ticketNumber: string) =>
    goLink({ dest: 'support', ticket: String(ticketNumber || '').trim() }),
  billingUrl: goLink({ dest: 'billing' }),
  subscriptionUrl: goLink({ dest: 'subscription' }),
} as const;
