/**
 * Content Studio — shared API helpers and navigation sync
 */
window.CutupContentStudio = (function () {
  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function apiBase() {
    const b = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.CUTUP_API_BASE || '';
    return String(b || window.location?.origin || '').replace(/\/$/, '');
  }

  const TRASH_ICON_SRC = '/assets/icons/trash.png';

  function friendlyApiMessage(data, fallback) {
    const raw = String(
      data?.detail || data?.message || data?.error || data?.hydrationError || fallback || ''
    );
    if (/^unauthorized$/i.test(raw.trim()) || raw === 'Unauthorized') {
      return 'Your session expired. Please sign in again.';
    }
    if (/forbidden|403/i.test(raw)) {
      return 'You do not have permission for this action.';
    }
    if (/file too large|limit/i.test(raw)) {
      return 'File is too large. Maximum size is 50 MB.';
    }
    if (/relation .* does not exist|42P01|syntax error at/i.test(raw)) {
      return 'Content Studio is not ready yet. Initialize the CMS tables or run migrations, then click Retry.';
    }
    return raw || fallback || 'Request failed';
  }

  function humanizeError(err, fallback = 'Something went wrong.') {
    return friendlyApiMessage({ message: err?.message, error: err?.error }, fallback);
  }

  function ensureToastHost() {
    let host = document.getElementById('csToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'csToastHost';
      host.className = 'cs-toast-host';
      host.setAttribute('aria-live', 'polite');
      document.body.append(host);
    }
    return host;
  }

  function notify(message, type = 'info', duration = 5200) {
    const text = String(message || '').trim();
    if (!text) return;
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.className = `cs-toast cs-toast--${type}`;
    toast.innerHTML = `<span class="cs-toast-msg">${esc(text)}</span><button type="button" class="cs-toast-close" aria-label="Dismiss">×</button>`;
    const close = () => {
      toast.classList.add('is-out');
      setTimeout(() => toast.remove(), 220);
    };
    toast.querySelector('.cs-toast-close')?.addEventListener('click', close);
    host.append(toast);
    requestAnimationFrame(() => toast.classList.add('is-in'));
    setTimeout(close, duration);
  }

  function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function syncMediaLibrary() {
    return apiPost('syncCmsMedia');
  }

  function isApiSuccess(data, statusOk) {
    if (data?.setupRequired) return false;
    if (data?.ok === true || data?.success === true) return statusOk;
    if (statusOk && (data?.page || data?.pages)) return true;
    if (statusOk && !data?.error) return true;
    return false;
  }

  function parseApiResponse(r, data) {
    if (data?.setupRequired) {
      const err = new Error(data.message || 'CMS setup required');
      err.name = 'CmsSetupRequired';
      err.setupRequired = true;
      err.payload = data;
      throw err;
    }
    if (!isApiSuccess(data, r.ok)) {
      throw new Error(friendlyApiMessage(data, 'Request failed'));
    }
    return data;
  }

  function parseUploadResponse(xhr) {
    let data = {};
    try {
      data = JSON.parse(xhr.responseText || '{}');
    } catch {
      data = {};
    }
    const statusOk = xhr.status >= 200 && xhr.status < 300;
    if (data?.setupRequired) {
      const err = new Error(data.message || 'CMS setup required');
      err.setupRequired = true;
      err.payload = data;
      throw err;
    }
    if (!statusOk || data?.ok === false) {
      throw new Error(friendlyApiMessage(data, 'Upload failed'));
    }
    if (data?.ok === true || data?.success === true || data?.file || data?.media) {
      return data;
    }
    if (statusOk && !data?.error) return data;
    throw new Error(friendlyApiMessage(data, 'Upload failed'));
  }

  function confirmAction(opts = {}) {
    return new Promise((resolve) => {
      const title = opts.title || 'Are you sure?';
      const message = opts.message || '';
      const confirmLabel = opts.confirmLabel || 'Confirm';
      const danger = Boolean(opts.danger);
      document.getElementById('csConfirmBackdrop')?.remove();
      const backdrop = document.createElement('div');
      backdrop.id = 'csConfirmBackdrop';
      backdrop.className = 'cs-confirm-backdrop';
      backdrop.innerHTML = `<div class="cs-confirm" role="dialog" aria-modal="true" aria-labelledby="csConfirmTitle">
        <h3 id="csConfirmTitle">${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="cs-confirm-actions">
          <button type="button" class="btn ghost" data-cs-cancel>Cancel</button>
          <button type="button" class="btn${danger ? ' btn-danger' : ''}" data-cs-ok>${esc(confirmLabel)}</button>
        </div>
      </div>`;
      document.body.appendChild(backdrop);
      const done = (val) => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') done(false);
      };
      document.addEventListener('keydown', onKey);
      backdrop.querySelector('[data-cs-cancel]')?.addEventListener('click', () => done(false));
      backdrop.querySelector('[data-cs-ok]')?.addEventListener('click', () => done(true));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) done(false);
      });
    });
  }

  async function apiGet(action, params = {}) {
    const q = new URLSearchParams({ action, ...params });
    const r = await fetch(`${apiBase()}/api/admin?${q}`, { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    return parseApiResponse(r, data);
  }

  async function apiPost(action, body = {}) {
    const r = await fetch(`${apiBase()}/api/admin`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body })
    });
    const data = await r.json().catch(() => ({}));
    return parseApiResponse(r, data);
  }

  async function fetchSetupStatus() {
    return apiGet('cmsSetupStatus');
  }

  async function runBootstrap() {
    return apiPost('cmsBootstrap');
  }

  async function uploadMedia(file, opts = {}) {
    if (opts.onProgress) return uploadMediaWithProgress(file, opts.onProgress);
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${apiBase()}/api/admin/cms/media`, {
      method: 'POST',
      credentials: 'include',
      body: fd
    });
    const data = await r.json().catch(() => ({}));
    return parseApiResponse(r, data);
  }

  function uploadMediaWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase()}/api/admin/cms/media`);
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      });
      xhr.addEventListener('load', () => {
        try {
          onProgress?.(100);
          resolve(parseUploadResponse(xhr));
        } catch (err) {
          reject(err);
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload failed. Check your connection.')));
      xhr.send(fd);
    });
  }

  function isSetupError(err) {
    return Boolean(err?.setupRequired || err?.name === 'CmsSetupRequired');
  }

  function renderSetupState(el, opts = {}) {
    if (!el) return;
    const missing = opts.missingTables || [];
    const tablesHint = missing.length
      ? `<p class="cs-setup-meta">Pending tables: ${missing.map((t) => esc(t)).join(', ')}</p>`
      : '';
    el.innerHTML = `<div class="cs-setup">
      <div class="cs-setup-card">
        <div class="cs-setup-icon" aria-hidden="true">✦</div>
        <h2>Content Studio is being prepared</h2>
        <p class="cs-setup-lead">The CMS database structure has not been initialized yet. Run migrations to enable Pages, Blog, and Library features.</p>
        ${tablesHint}
        <div class="cs-setup-actions">
          <button type="button" class="btn" id="csSetupRetry">Retry</button>
          <button type="button" class="btn ghost" id="csSetupBootstrap">Initialize CMS tables</button>
          <button type="button" class="btn ghost" id="csSetupDocs">View setup instructions</button>
        </div>
        <details class="cs-setup-details" id="csSetupDetails" hidden>
          <summary>Setup instructions</summary>
          <ol>
            <li>Confirm <code>DATABASE_URL</code> is configured on the API server.</li>
            <li>From the project root, run: <code>node api/db/migrate.mjs</code></li>
            <li>Return here and click <strong>Retry</strong>, or use <strong>Initialize CMS tables</strong> for a safe automatic setup.</li>
          </ol>
        </details>
        <p class="cs-setup-foot" id="csSetupStatus" hidden></p>
      </div>
    </div>`;

    el.querySelector('#csSetupRetry')?.addEventListener('click', () => opts.onRetry?.());
    el.querySelector('#csSetupBootstrap')?.addEventListener('click', async () => {
      const statusEl = el.querySelector('#csSetupStatus');
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'Initializing tables…';
      }
      try {
        await runBootstrap();
        if (statusEl) statusEl.textContent = 'Done. Reloading…';
        await opts.onRetry?.();
      } catch (e) {
        if (statusEl) statusEl.textContent = friendlyApiMessage({ message: e.message }, 'Initialization failed.');
      }
    });
    el.querySelector('#csSetupDocs')?.addEventListener('click', () => {
      el.querySelector('#csSetupDetails')?.removeAttribute('hidden');
    });
  }

  function isSuperAdmin() {
    return typeof window !== 'undefined' && window.__CUTUP_ADMIN_ROLE__ === 'super_admin';
  }

  function statusBadge(status) {
    const s = String(status || 'draft').toLowerCase();
    const cls = s === 'deleted' ? 'trash' : s;
    const label = s === 'deleted' ? 'trash' : s;
    return `<span class="cs-badge cs-badge--${esc(cls)}">${esc(label)}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '—';
    }
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
  }

  function renderTaxonomyShell(el, { title, subtitle, sectionLabel }) {
    if (!el) return;
    el.innerHTML = `<div class="cs-root cs-taxonomy-shell">
      <header class="cs-hero">
        <div>
          <p class="cs-taxonomy-kicker">${esc(sectionLabel)}</p>
          <h2>${esc(title)}</h2>
          <p class="cs-subtitle">${esc(subtitle)}</p>
        </div>
      </header>
      <div class="cs-taxonomy-card">
        <p>Taxonomy management is part of the Pages CMS foundation. This workspace will connect to categories and tags in the next phase.</p>
      </div>
    </div>`;
  }

  function loadWorkspace(section, view) {
    if (section === 'pages' && window.CutupContentPages?.loadView) {
      return window.CutupContentPages.loadView(view || 'all');
    }
    if (section === 'blog' && window.CutupContentBlog?.loadView) {
      return window.CutupContentBlog.loadView(view || 'all');
    }
    return Promise.resolve();
  }

  function destroyInactive(activeSection) {
    if (activeSection !== 'pages') window.CutupContentPages?.destroy?.();
    if (activeSection !== 'blog') window.CutupContentBlog?.destroy?.();
  }

  function loadSection(section) {
    if (section === 'content-pages') return loadWorkspace('pages', 'all');
    if (section === 'content-blog') return loadWorkspace('blog', 'all');
    if (section === 'content-library' && window.CutupContentMedia?.load) return window.CutupContentMedia.load();
    return Promise.resolve();
  }

  function destroyAll() {
    window.CutupContentBlog?.destroy?.();
    window.CutupContentPages?.destroy?.();
  }

  return {
    esc,
    isSuperAdmin,
    apiGet,
    apiPost,
    fetchSetupStatus,
    runBootstrap,
    uploadMedia,
    uploadMediaWithProgress,
    syncMediaLibrary,
    notify,
    humanizeError,
    formatBytes,
    isSetupError,
    renderSetupState,
    friendlyApiMessage,
    statusBadge,
    fmtDate,
    slugify,
    loadSection,
    loadWorkspace,
    renderTaxonomyShell,
    destroyInactive,
    destroyAll,
    confirmAction,
    TRASH_ICON_SRC
  };
})();
