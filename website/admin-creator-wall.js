/**
 * Admin — Creator Wall moderation
 */
(function () {
  'use strict';

  const API = '/api/admin/creator-wall';

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function api(method, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  function renderTable(posts, pending) {
    const host = document.getElementById('creatorWallAdminTable');
    const badge = document.getElementById('creatorWallPendingBadge');
    if (badge) badge.textContent = pending ? `${pending} pending` : '';
    if (!host) return;

    if (!posts.length) {
      host.innerHTML = '<p class="admin-muted">No Creator Wall posts yet. Curated seed shows on homepage when empty.</p>';
      return;
    }

    host.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Style</th>
              <th>Platform</th>
              <th>Feedback</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${posts
              .map((p) => {
                const status = p.hidden
                  ? 'Hidden'
                  : p.approved
                    ? p.featured
                      ? 'Featured'
                      : 'Approved'
                    : 'Pending';
                return `<tr data-id="${escapeHtml(p.id)}">
                  <td>${escapeHtml(p.creatorName || '—')}<br><small>${escapeHtml(p.socialHandle || p.userEmail || '')}</small></td>
                  <td>${escapeHtml(p.presetLabel || p.stylePreset)}</td>
                  <td>${escapeHtml(p.platform)}</td>
                  <td style="max-width:220px">${escapeHtml((p.feedback || '').slice(0, 120))}</td>
                  <td>${escapeHtml(status)}</td>
                  <td class="creator-wall-admin-actions">
                    ${!p.approved ? `<button type="button" class="btn small" data-cw-action="approve">Approve</button>` : ''}
                    ${p.approved && !p.featured ? `<button type="button" class="btn ghost small" data-cw-action="feature">Pin</button>` : ''}
                    ${p.featured ? `<button type="button" class="btn ghost small" data-cw-action="unfeature">Unpin</button>` : ''}
                    ${!p.hidden ? `<button type="button" class="btn ghost small" data-cw-action="hide">Hide</button>` : `<button type="button" class="btn ghost small" data-cw-action="unhide">Restore</button>`}
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;

    host.querySelectorAll('[data-cw-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = row?.getAttribute('data-id');
        const action = btn.getAttribute('data-cw-action');
        if (!id || !action) return;
        btn.disabled = true;
        try {
          const patch = { id, action: 'moderate' };
          if (action === 'approve') patch.approved = true;
          if (action === 'feature') {
            patch.approved = true;
            patch.featured = true;
          }
          if (action === 'unfeature') patch.featured = false;
          if (action === 'hide') patch.hidden = true;
          if (action === 'unhide') {
            patch.hidden = false;
            patch.approved = true;
          }
          await api('POST', patch);
          await loadCreatorWallAdmin();
        } catch (err) {
          alert(err.message || 'Action failed');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function loadCreatorWallAdmin() {
    const data = await api('GET');
    renderTable(data.posts || [], data.pending || 0);
  }

  async function createSample() {
    await api('POST', {
      action: 'create',
      stylePreset: 'hormozi',
      platform: 'tiktok',
      countryCode: 'US',
      creatorName: 'Sample Creator',
      socialHandle: '@sample',
      feedback: 'Cutup made my captions look incredible.',
      approved: true,
      featured: false
    });
    await loadCreatorWallAdmin();
  }

  window.loadCreatorWallAdmin = loadCreatorWallAdmin;

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('creatorWallAdminRefresh')?.addEventListener('click', () => {
      loadCreatorWallAdmin().catch((e) => alert(e.message));
    });
    document.getElementById('creatorWallAdminCreateSample')?.addEventListener('click', () => {
      createSample().catch((e) => alert(e.message));
    });
  });
})();
