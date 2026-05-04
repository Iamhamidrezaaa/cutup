/** Lightweight UA parse — no external deps. */
export function parseClientUa(ua) {
  const s = String(ua || '');
  let browser = 'unknown';
  if (/Edg(?:e|A|i)?\//i.test(s)) browser = 'edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'opera';
  else if (/Chrome\//i.test(s) && !/Edg/i.test(s)) browser = 'chrome';
  else if (/Firefox\//i.test(s)) browser = 'firefox';
  else if (/Safari/i.test(s) && !/Chrome|Chromium/i.test(s)) browser = 'safari';

  let device = 'desktop';
  if (/iPad|Tablet/i.test(s)) device = 'tablet';
  else if (/Mobile|Android|iPhone|webOS|BlackBerry/i.test(s)) device = 'mobile';

  return { browser: browser.slice(0, 32), device: device.slice(0, 32) };
}
