/**
 * My Projects dashboard module.
 */
(function (global) {
  'use strict';

  const state = {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    filter: 'all',
    search: '',
    searchTimer: null,
    loading: false,
    detail: null,
    apiBase: '',
    session: null,
    escapeHtml: (v) => String(v ?? ''),
    formatDateTime: (v) => String(v ?? '—'),
    showBanner: () => {},
    apiGet: null,
    apiPost: null
  };

  function platformIcon(platform) {
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube') return '▶️';
    if (p === 'tiktok') return '🎵';
    if (p === 'instagram') return '📷';
    if (p === 'audiofile') return '📁';
    return '🎬';
  }

  function statusBadge(label, kind) {
    return `<span class="cutup-project-badge cutup-project-badge--${kind}">${label}</span>`;
  }

  function transcriptBadge(status) {
    if (status === 'ready') return statusBadge('Transcript ready', 'ready');
    if (status === 'in_progress') return statusBadge('Transcript in progress', 'progress');
    return statusBadge('No transcript', 'progress');
  }

  function exportBadge(status) {
    if (status === 'exported') return statusBadge('Exported', 'exported');
    if (status === 'in_progress') return statusBadge('Export in progress', 'progress');
    if (status === 'failed') return statusBadge('Export failed', 'failed');
    return statusBadge('Not exported', 'progress');
  }

  function formatDuration(sec) {
    const s = Math.round(Number(sec) || 0);
    if (!s) return '—';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function projectTitle(p) {
    return (
      String(p.title || '').trim() ||
      String(p.sourceFilename || '').trim() ||
      String(p.sourceUrl || '').replace(/^https?:\/\//, '').slice(0, 60) ||
      'Untitled project'
    );
  }

  function sourceLabel(p) {
    if (p.sourceFilename) return p.sourceFilename;
    if (p.sourceUrl) return p.sourceUrl;
    return 'No source linked';
  }

  async function fetchProjects() {
    if (!state.apiGet || !state.session) return;
    state.loading = true;
    render();
    const q = new URLSearchParams({
      action: 'list',
      filter: state.filter,
      search: state.search,
      page: String(state.page),
      limit: String(state.limit)
    });
    try {
      const { response, data } = await state.apiGet(
        `${state.apiBase}/api/projects?${q.toString()}`,
        { headers: { 'X-Session-Id': state.session } }
      );
      if (!response.ok) {
        if (response.status === 403 && data?.error) {
          state.showBanner(data.error, 'error');
          state.items = [];
          state.total = 0;
          return;
        }
        const msg = [data?.message, data?.hint, data?.error].filter(Boolean).join(' — ') || 'load_failed';
        throw new Error(msg);
      }
      state.items = data.items || [];
      state.total = data.total || 0;
      state.totalPages = data.totalPages || 1;
      state.page = data.page || state.page;
    } catch (err) {
      console.error('[projects]', err);
      state.showBanner('Could not load projects. Try again.', 'error');
      state.items = [];
    } finally {
      state.loading = false;
      render();
    }
  }

  async function openDetail(projectId) {
    try {
      const { response, data } = await state.apiGet(
        `${state.apiBase}/api/projects?action=get&id=${encodeURIComponent(projectId)}`,
        { headers: { 'X-Session-Id': state.session } }
      );
      if (!response.ok) throw new Error('not_found');
      state.detail = data;
      render();
      document.getElementById('cutupProjectDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      state.showBanner('Could not open this project.', 'error');
    }
  }

  async function continueEditing(projectId) {
    try {
      const { response, data } = await state.apiGet(
        `${state.apiBase}/api/projects?action=restore&id=${encodeURIComponent(projectId)}`,
        { headers: { 'X-Session-Id': state.session } }
      );
      if (!response.ok || !data?.payload) throw new Error('restore_failed');
      const p = data.payload;
      const workspace = {
        schema: 1,
        savedAt: Date.now(),
        sessionId: state.session,
        lastTranscription: {
          summary: p.summary,
          fullText: p.fullText,
          transcription: p.fullText,
          segments: p.segments || [],
          title: p.title,
          platform: p.platform,
          sourceUrl: p.sourceUrl,
          lastDisplayOptions: {
            platform: p.platform,
            title: p.title,
            sourceUrl: p.sourceUrl,
            originalLanguage: p.language,
            outputMode: 'unified',
            activeTab: 'srt'
          }
        },
        sourceUrl: p.sourceUrl || '',
        stylePreset: p.settings?.stylePreset || null,
        detectedSourceLanguage: p.language || null,
        currentSrtContent: p.srt || null,
        originalFullText: p.fullText || null,
        activeTab: 'srt'
      };
      try {
        localStorage.setItem('cutup_workspace_v1', JSON.stringify(workspace));
        if (p.sourceUrl) {
          localStorage.setItem('cutup_pending_url', p.sourceUrl);
          localStorage.setItem('cutup_pending_platform', p.platform || 'youtube');
        }
      } catch {
        /* ignore */
      }
      const origin = global.location?.origin || '';
      global.location.href = `${origin}/?project=${encodeURIComponent(projectId)}`;
    } catch {
      state.showBanner('Could not restore this project for editing.', 'error');
    }
  }

  async function downloadLatestExport(projectId) {
    try {
      const { response, data } = await state.apiGet(
        `${state.apiBase}/api/projects?action=latestExport&id=${encodeURIComponent(projectId)}`,
        { headers: { 'X-Session-Id': state.session } }
      );
      if (!response.ok || !data?.export?.renderJobId) {
        state.showBanner('No completed export available for download.', 'info');
        return;
      }
      const jobId = data.export.renderJobId;
      const url = `${state.apiBase}/api/export-video?action=download&jobId=${encodeURIComponent(jobId)}&session=${encodeURIComponent(state.session)}`;
      global.open(url, '_blank', 'noopener');
    } catch {
      state.showBanner('Download failed. The export may have expired — try exporting again.', 'error');
    }
  }

  async function renameProject(projectId, currentTitle) {
    const next = global.prompt('Rename project', currentTitle || '');
    if (next == null) return;
    const { response } = await state.apiPost(
      `${state.apiBase}/api/projects?action=rename`,
      { id: projectId, title: next },
      { headers: { 'X-Session-Id': state.session } }
    );
    if (!response.ok) {
      state.showBanner('Rename failed.', 'error');
      return;
    }
    state.showBanner('Project renamed.', 'success');
    await fetchProjects();
    if (state.detail?.project?.id === projectId) await openDetail(projectId);
  }

  async function duplicateProject(projectId) {
    const { response } = await state.apiPost(
      `${state.apiBase}/api/projects?action=duplicate`,
      { id: projectId },
      { headers: { 'X-Session-Id': state.session } }
    );
    if (!response.ok) {
      state.showBanner('Could not duplicate project.', 'error');
      return;
    }
    state.showBanner('Project duplicated.', 'success');
    state.filter = 'all';
    state.page = 1;
    await fetchProjects();
  }

  async function deleteProject(projectId) {
    if (!global.confirm('Delete this project and all saved outputs? This cannot be undone.')) return;
    const { response } = await state.apiPost(
      `${state.apiBase}/api/projects?action=delete`,
      { id: projectId },
      { headers: { 'X-Session-Id': state.session } }
    );
    if (!response.ok) {
      state.showBanner('Delete failed.', 'error');
      return;
    }
    state.showBanner('Project deleted.', 'success');
    if (state.detail?.project?.id === projectId) state.detail = null;
    await fetchProjects();
  }

  function renderEmpty() {
    const isArchived = state.filter === 'archived';
    const isSearch = Boolean(state.search);
    if (isSearch) {
      return `
        <div class="cutup-projects-empty">
          <div class="cutup-projects-empty__icon">🔍</div>
          <h3>No projects match your search</h3>
          <p>Try a different title, URL, or phrase from your transcript.</p>
          <button type="button" class="plan-btn" data-projects-clear-search>Clear search</button>
        </div>`;
    }
    if (isArchived) {
      return `
        <div class="cutup-projects-empty">
          <div class="cutup-projects-empty__icon">📦</div>
          <h3>No archived projects</h3>
          <p>Projects you archive will appear here for safekeeping.</p>
        </div>`;
    }
    if (state.filter === 'exported') {
      return `
        <div class="cutup-projects-empty">
          <div class="cutup-projects-empty__icon">🎬</div>
          <h3>No exported projects yet</h3>
          <p>Export a viral MP4 from the editor — your finished clips will show up here.</p>
          <button type="button" class="plan-btn" data-projects-new>Start a project</button>
        </div>`;
    }
    return `
      <div class="cutup-projects-empty">
        <div class="cutup-projects-empty__icon">✨</div>
        <h3>Your workspace is ready</h3>
        <p>Paste a link or upload a file — Cutup saves transcripts, subtitles, and exports automatically to your account.</p>
        <button type="button" class="plan-btn" data-projects-new>Create your first project</button>
      </div>`;
  }

  function renderCard(p) {
    const title = state.escapeHtml(projectTitle(p));
    const source = state.escapeHtml(sourceLabel(p));
    const thumb = p.thumbnailUrl
      ? `<img class="cutup-project-card__thumb" src="${state.escapeHtml(p.thumbnailUrl)}" alt="" loading="lazy" decoding="async">`
      : `<div class="cutup-project-card__thumb-fallback" aria-hidden="true">${platformIcon(p.platform)}</div>`;
    return `
      <article class="cutup-project-card" data-project-id="${state.escapeHtml(p.id)}">
        <div class="cutup-project-card__media">${thumb}</div>
        <div class="cutup-project-card__body">
          <h3 class="cutup-project-card__title" title="${title}">${title}</h3>
          <p class="cutup-project-card__source" title="${source}">${source}</p>
          <div class="cutup-project-card__meta">
            ${transcriptBadge(p.transcriptStatus)}
            ${exportBadge(p.exportStatus)}
            ${p.exportCount ? statusBadge(`${p.exportCount} export${p.exportCount > 1 ? 's' : ''}`, 'exported') : ''}
          </div>
          <div class="cutup-project-card__dates">
            <div>Created ${state.formatDateTime(p.createdAt)}</div>
            <div>Updated ${state.formatDateTime(p.updatedAt)}</div>
          </div>
          <div class="cutup-project-card__actions">
            <button type="button" class="cutup-project-btn cutup-project-btn--primary" data-project-open="${state.escapeHtml(p.id)}">Open</button>
            <button type="button" class="cutup-project-btn" data-project-edit="${state.escapeHtml(p.id)}">Continue</button>
            ${p.exportStatus === 'exported' ? `<button type="button" class="cutup-project-btn" data-project-dl="${state.escapeHtml(p.id)}">Download</button>` : ''}
            <button type="button" class="cutup-project-btn" data-project-more="${state.escapeHtml(p.id)}">More ▾</button>
          </div>
        </div>
      </article>`;
  }

  function renderDetail() {
    if (!state.detail?.project) return '';
    const p = state.detail.project;
    const exports = state.detail.exports || [];
    const title = state.escapeHtml(projectTitle(p));
    const exportRows = exports.length
      ? exports
          .map((e) => {
            const dl =
              e.status === 'completed' && e.renderJobId
                ? `<button type="button" class="cutup-project-btn cutup-project-btn--primary" data-export-dl="${state.escapeHtml(e.renderJobId)}">Download</button>`
                : `<span class="cutup-project-badge">${state.escapeHtml(e.status)}</span>`;
            return `
            <div class="cutup-export-row">
              <div class="cutup-export-row__meta">
                <div class="cutup-export-row__style">${state.escapeHtml(e.presetName || e.presetId || 'Style')}</div>
                <div class="cutup-export-row__sub">
                  ${state.escapeHtml(e.quality === 'hq' ? 'High quality' : 'Fast preview')}
                  · ${state.formatDateTime(e.completedAt || e.createdAt)}
                  · Render ${formatDuration(e.renderDurationSec)}
                  · Clip ${formatDuration(e.videoDurationSec)}
                  · ${formatFileSize(e.fileSizeBytes)}
                </div>
              </div>
              ${dl}
            </div>`;
          })
          .join('')
      : '<p class="dashboard-empty-note">No exports yet for this project.</p>';

    return `
      <div class="cutup-project-detail" id="cutupProjectDetail">
        <div class="cutup-project-detail__head">
          <div>
            <h3 class="cutup-project-detail__title">${title}</h3>
            <p class="cutup-project-card__source">${state.escapeHtml(sourceLabel(p))}</p>
          </div>
          <div class="cutup-project-card__actions">
            <button type="button" class="cutup-project-btn cutup-project-btn--primary" data-project-edit="${state.escapeHtml(p.id)}">Continue editing</button>
            <button type="button" class="cutup-project-btn" data-project-rename="${state.escapeHtml(p.id)}" data-project-title="${title}">Rename</button>
            <button type="button" class="cutup-project-btn" data-project-dup="${state.escapeHtml(p.id)}">Duplicate</button>
            <button type="button" class="cutup-project-btn cutup-project-btn--danger" data-project-del="${state.escapeHtml(p.id)}">Delete</button>
          </div>
        </div>
        <div class="cutup-project-detail__section">
          <h4>Export history</h4>
          <div class="cutup-export-history">${exportRows}</div>
        </div>
      </div>`;
  }

  function render() {
    const root = document.getElementById('cutupProjectsRoot');
    if (!root) return;

    if (state.loading) {
      root.innerHTML = '<div class="cutup-projects-loading">Loading your projects…</div>';
      return;
    }

    const filters = [
      ['all', 'All Projects'],
      ['in_progress', 'In Progress'],
      ['exported', 'Exported'],
      ['archived', 'Archived']
    ];

    const cards = state.items.length
      ? `<div class="cutup-projects-grid">${state.items.map(renderCard).join('')}</div>`
      : renderEmpty();

    const pagination =
      state.totalPages > 1
        ? `
      <div class="cutup-projects-pagination">
        <button type="button" class="cutup-project-btn" data-projects-page="prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="cutup-projects-pagination__info">Page ${state.page} of ${state.totalPages} · ${state.total} projects</span>
        <button type="button" class="cutup-project-btn" data-projects-page="next" ${state.page >= state.totalPages ? 'disabled' : ''}>Next</button>
      </div>`
        : state.total > 0
          ? `<p class="cutup-projects-pagination__info cutup-projects-pagination">${state.total} project${state.total === 1 ? '' : 's'}</p>`
          : '';

    root.innerHTML = `
      <div class="cutup-projects-toolbar">
        <input type="search" class="cutup-projects-search" placeholder="Search title, URL, or transcript…" value="${state.escapeHtml(state.search)}" aria-label="Search projects">
        <div class="cutup-projects-filters">
          ${filters
            .map(
              ([id, label]) =>
                `<button type="button" class="cutup-projects-filter-btn ${state.filter === id ? 'is-active' : ''}" data-projects-filter="${id}">${label}</button>`
            )
            .join('')}
        </div>
      </div>
      ${cards}
      ${pagination}
      ${renderDetail()}
    `;

    bindEvents(root);
  }

  function bindEvents(root) {
    root.querySelector('.cutup-projects-search')?.addEventListener('input', (e) => {
      const v = e.target.value;
      if (state.searchTimer) clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.search = v;
        state.page = 1;
        fetchProjects();
      }, 320);
    });

    root.querySelectorAll('[data-projects-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filter = btn.getAttribute('data-projects-filter') || 'all';
        state.page = 1;
        state.detail = null;
        fetchProjects();
      });
    });

    root.querySelector('[data-projects-page="prev"]')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        fetchProjects();
      }
    });
    root.querySelector('[data-projects-page="next"]')?.addEventListener('click', () => {
      if (state.page < state.totalPages) {
        state.page += 1;
        fetchProjects();
      }
    });

    root.querySelector('[data-projects-clear-search]')?.addEventListener('click', () => {
      state.search = '';
      state.page = 1;
      fetchProjects();
    });

    root.querySelector('[data-projects-new]')?.addEventListener('click', () => {
      const origin = global.location?.origin || '';
      global.location.href = `${origin}/`;
    });

    root.querySelectorAll('[data-project-open]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.getAttribute('data-project-open')));
    });
    root.querySelectorAll('[data-project-edit]').forEach((btn) => {
      btn.addEventListener('click', () => continueEditing(btn.getAttribute('data-project-edit')));
    });
    root.querySelectorAll('[data-project-dl]').forEach((btn) => {
      btn.addEventListener('click', () => downloadLatestExport(btn.getAttribute('data-project-dl')));
    });
    root.querySelectorAll('[data-export-dl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const jobId = btn.getAttribute('data-export-dl');
        const url = `${state.apiBase}/api/export-video?action=download&jobId=${encodeURIComponent(jobId)}&session=${encodeURIComponent(state.session)}`;
        global.open(url, '_blank', 'noopener');
      });
    });
    root.querySelectorAll('[data-project-rename]').forEach((btn) => {
      btn.addEventListener('click', () =>
        renameProject(btn.getAttribute('data-project-rename'), btn.getAttribute('data-project-title'))
      );
    });
    root.querySelectorAll('[data-project-dup]').forEach((btn) => {
      btn.addEventListener('click', () => duplicateProject(btn.getAttribute('data-project-dup')));
    });
    root.querySelectorAll('[data-project-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteProject(btn.getAttribute('data-project-del')));
    });
    root.querySelectorAll('[data-project-more]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-project-more');
        const action = global.prompt('Choose: rename, duplicate, delete, archive', 'rename');
        if (!action) return;
        const a = action.trim().toLowerCase();
        if (a.startsWith('ren')) return renameProject(id, projectTitle(state.items.find((x) => x.id === id) || {}));
        if (a.startsWith('dup')) return duplicateProject(id);
        if (a.startsWith('del')) return deleteProject(id);
        if (a.startsWith('arc')) {
          return state
            .apiPost(`${state.apiBase}/api/projects?action=archive`, { id, archived: true }, { headers: { 'X-Session-Id': state.session } })
            .then(() => {
              state.showBanner('Project archived.', 'success');
              fetchProjects();
            });
        }
        openDetail(id);
      });
    });
  }

  function init(opts) {
    Object.assign(state, opts || {});
    return fetchProjects();
  }

  global.CutupDashboardProjects = { init, refresh: fetchProjects, render };
})(typeof window !== 'undefined' ? window : globalThis);
