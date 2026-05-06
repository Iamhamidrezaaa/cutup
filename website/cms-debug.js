/**
 * CMS client debug surface — window.__cmsDebug
 */
window.__cmsDebug = window.__cmsDebug || {
  loadedPage: null,
  hydratedPage: null,
  normalizedBlocks: null,
  persistedPayload: null,
  lastApiError: null,
  lastNavigate: null
};

window.cmsDebugSet = function cmsDebugSet(key, value) {
  if (!window.__cmsDebug) window.__cmsDebug = {};
  window.__cmsDebug[key] = value;
  try {
    console.info('[CMS]', key, value);
  } catch {
    /* ignore */
  }
};
