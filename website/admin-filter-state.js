/**
 * Admin table/analytics filters — sessionStorage only (never URL).
 */
window.CutupAdminFilterState = (function () {
  const NAV_KEYS = new Set(['section', 'view', 'id']);
  const FILTER_PREFIXES = [
    'usage',
    'out',
    'pay',
    'axl_'
  ];

  function filterKey(section) {
    return `cutup_admin_filters_${String(section || '').trim().toLowerCase()}`;
  }

  function isFilterParam(key) {
    const k = String(key || '');
    if (NAV_KEYS.has(k)) return false;
    if (k === 'signed_out' || k === 'session_expired') return false;
    return FILTER_PREFIXES.some((p) => k === p || k.startsWith(p));
  }

  function loadAdminFilterState(section) {
    try {
      const raw = sessionStorage.getItem(filterKey(section));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveAdminFilterState(section, state) {
    try {
      sessionStorage.setItem(filterKey(section), JSON.stringify(state || {}));
    } catch (err) {
      console.error('[Admin Filters]', err);
    }
  }

  function clearAdminFilterStates() {
    try {
      Object.keys(sessionStorage).forEach((k) => {
        if (k.startsWith('cutup_admin_filters_')) sessionStorage.removeItem(k);
      });
    } catch {
      /* ignore */
    }
  }

  function readUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  function migrateUsageFromUrl(p) {
    if (!p.get('usagePreset') && !p.get('usageType') && !p.get('usagePage')) return;
    saveAdminFilterState('usage', {
      preset: p.get('usagePreset') || 'all',
      type: p.get('usageType') || 'all',
      platform: p.get('usagePlatform') || 'all',
      plan: p.get('usagePlan') || 'all',
      country: p.get('usageCountry') || 'all',
      search: p.get('usageSearch') || '',
      page: Number(p.get('usagePage')) || 1,
      startDate: p.get('usageStart') || '',
      endDate: p.get('usageEnd') || ''
    });
  }

  function migrateOutputsFromUrl(p) {
    if (!p.get('outPreset') && !p.get('outPage') && !p.get('outType')) return;
    saveAdminFilterState('outputs', {
      preset: p.get('outPreset') || 'all',
      type: p.get('outType') || 'all',
      platform: p.get('outPlatform') || 'all',
      language: p.get('outLanguage') || 'all',
      plan: p.get('outPlan') || 'all',
      search: p.get('outSearch') || '',
      page: Number(p.get('outPage')) || 1,
      startDate: p.get('outStart') || '',
      endDate: p.get('outEnd') || '',
      highLength: p.get('outLong') === '1',
      aiHeavy: p.get('outAi') === '1',
      showArchived: p.get('outArch') === '1'
    });
  }

  function migratePaymentsFromUrl(p) {
    if (!p.get('payPreset') && !p.get('payPage') && !p.get('payProvider')) return;
    saveAdminFilterState('payments', {
      preset: p.get('payPreset') || '30d',
      search: p.get('paySearch') || '',
      provider: p.get('payProvider') || 'all',
      status: p.get('payStatus') || 'all',
      callbackStatus: p.get('payCallback') || 'all',
      plan: p.get('payPlan') || 'all',
      country: p.get('payCountry') || 'all',
      page: Number(p.get('payPage')) || 1,
      startDate: p.get('payStart') || '',
      endDate: p.get('payEnd') || '',
      failedOnly: p.get('payFailed') === '1',
      retriesOnly: p.get('payRetries') === '1',
      highValueOnly: p.get('payHigh') === '1',
      sandboxOnly: p.get('paySandbox') === '1',
      liveOnly: p.get('payLive') === '1',
      minAmount: p.get('payMin') || '',
      maxAmount: p.get('payMax') || ''
    });
  }

  function migrateAuditFromUrl(p) {
    if (!p.get('axl_preset') && !p.get('axl_page') && !p.get('axl_email')) return;
    saveAdminFilterState('audit', {
      preset: p.get('axl_preset') || '24h',
      page: Math.max(1, Number(p.get('axl_page')) || 1),
      liveMode: p.get('axl_live') === '1',
      filters: {
        email: p.get('axl_email') || '',
        userId: p.get('axl_user') || '',
        eventName: p.get('axl_event') || '',
        eventType: p.get('axl_type') || '',
        severity: p.get('axl_sev') || '',
        category: p.get('axl_cat') || '',
        country: p.get('axl_country') || '',
        ip: p.get('axl_ip') || '',
        sessionId: p.get('axl_session') || '',
        plan: p.get('axl_plan') || 'all',
        provider: p.get('axl_provider') || '',
        requestId: p.get('axl_req') || '',
        paymentEvents: p.get('axl_pay') === '1',
        authEvents: p.get('axl_auth') === '1',
        aiEvents: p.get('axl_ai') === '1',
        adminOnly: p.get('axl_admin') === '1',
        customerOnly: p.get('axl_cust') === '1'
      }
    });
  }

  function migrateFiltersFromUrl() {
    const p = readUrlParams();
    migrateUsageFromUrl(p);
    migrateOutputsFromUrl(p);
    migratePaymentsFromUrl(p);
    migrateAuditFromUrl(p);
  }

  function stripFilterParamsFromUrl({ replace = true } = {}) {
    try {
      const url = new URL(window.location.href);
      const section = url.searchParams.get('section');
      const view = url.searchParams.get('view');
      const id = url.searchParams.get('id');
      let dirty = false;
      [...url.searchParams.keys()].forEach((k) => {
        if (isFilterParam(k)) {
          url.searchParams.delete(k);
          dirty = true;
        }
      });
      if (!dirty && !section) return;
      if (section) url.searchParams.set('section', section);
      else url.searchParams.delete('section');
      if (view) url.searchParams.set('view', view);
      else url.searchParams.delete('view');
      if (id) url.searchParams.set('id', id);
      else url.searchParams.delete('id');
      const qs = url.searchParams.toString();
      const next = url.pathname + (qs ? `?${qs}` : '');
      if (replace) history.replaceState({}, '', next);
      else history.pushState({}, '', next);
    } catch (err) {
      console.error('[Admin URL]', err);
    }
  }

  const PATH_NAV_SECTIONS = new Set([
    'overview', 'usage', 'outputs', 'payments', 'offers', 'creator-wall',
    'health', 'email-preview', 'notifications', 'ops', 'audit'
  ]);

  function adminHaPathBase() {
    try {
      const path = window.location.pathname || '';
      const lower = path.toLowerCase();
      const i = lower.indexOf('adminha.html');
      if (i >= 0) return path.slice(0, i + 'adminha.html'.length);
    } catch (_e) { /* noop */ }
    return '/adminha.html';
  }

  function setAdminNavUrl(section, view, id) {
    try {
      const url = new URL(window.location.href);
      [...url.searchParams.keys()].forEach((k) => {
        if (isFilterParam(k) || k === 'signed_out' || k === 'session_expired') {
          url.searchParams.delete(k);
        }
      });
      const usePathNav = section && PATH_NAV_SECTIONS.has(section) && !view && (id == null || id === '');
      if (usePathNav) {
        url.pathname = section === 'overview'
          ? adminHaPathBase()
          : `${adminHaPathBase()}/${section}`;
        url.searchParams.delete('section');
        url.searchParams.delete('view');
        url.searchParams.delete('id');
      } else {
        url.pathname = adminHaPathBase();
        if (section) url.searchParams.set('section', section);
        else url.searchParams.delete('section');
        if (view) url.searchParams.set('view', view);
        else url.searchParams.delete('view');
        if (id != null && id !== '') url.searchParams.set('id', String(id));
        else url.searchParams.delete('id');
      }
      const qs = url.searchParams.toString();
      history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : ''));
    } catch (err) {
      console.error('[Admin URL]', err);
    }
  }

  return {
    loadAdminFilterState,
    saveAdminFilterState,
    clearAdminFilterStates,
    migrateFiltersFromUrl,
    stripFilterParamsFromUrl,
    setAdminNavUrl,
    isFilterParam
  };
})();
