export type InstalogistUiMode = 'operational' | 'demo';

const LS_KEY = 'instalogist-ui-mode';

export function getUiMode(): InstalogistUiMode {
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls === 'demo' || ls === 'operational') return ls;
  } catch {
    /* private mode */
  }
  const v = import.meta.env.VITE_INSTALOGIST_UI_MODE?.trim().toLowerCase();
  return v === 'demo' ? 'demo' : 'operational';
}

export function setUiMode(mode: InstalogistUiMode): void {
  try {
    localStorage.setItem(LS_KEY, mode);
  } catch {
    /* ignore */
  }
}
