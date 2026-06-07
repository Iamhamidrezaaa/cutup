/**
 * Admin — email template preview + test send.
 */
(function () {
  'use strict';

  var state = { templates: [], selected: null, preview: null, dataJson: '{}' };

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function apiBase() {
    return window.location.origin;
  }

  async function api(path, opts) {
    var r = await fetch(apiBase() + path, Object.assign({ credentials: 'include' }, opts || {}));
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  function renderShell(root) {
    root.innerHTML =
      '<div class="admin-email-preview">' +
        '<header class="admin-email-preview__head">' +
          '<h2>Email Platform</h2>' +
          '<p class="admin-muted">Preview and test all Cutup transactional emails (Resend + React Email).</p>' +
        '</header>' +
        '<div class="admin-email-preview__layout">' +
          '<aside class="admin-email-preview__list" id="emailTemplateList"><p class="admin-muted">Loading…</p></aside>' +
          '<main class="admin-email-preview__main">' +
            '<div class="admin-email-preview__toolbar">' +
              '<label>Variables (JSON)<textarea id="emailDataJson" rows="6" class="admin-input"></textarea></label>' +
              '<div class="admin-email-preview__actions">' +
                '<button type="button" class="admin-btn" id="emailPreviewBtn">Refresh preview</button>' +
                '<input type="email" id="emailTestRecipient" class="admin-input" placeholder="Test recipient email" />' +
                '<button type="button" class="admin-btn admin-btn--primary" id="emailSendTestBtn">Send test</button>' +
              '</div>' +
              '<p id="emailPreviewStatus" class="admin-muted"></p>' +
            '</div>' +
            '<div class="admin-email-preview__meta" id="emailPreviewMeta"></div>' +
            '<iframe id="emailPreviewFrame" class="admin-email-preview__frame" title="Email preview"></iframe>' +
          '</main>' +
        '</div>' +
      '</div>';
  }

  function renderList() {
    var list = document.getElementById('emailTemplateList');
    if (!list) return;
    if (!state.templates.length) {
      list.innerHTML = '<p class="admin-muted">No templates found.</p>';
      return;
    }
    list.innerHTML = state.templates
      .map(function (t) {
        var id = t.id || t.template;
        var active = state.selected === id ? ' is-active' : '';
        return (
          '<button type="button" class="admin-email-preview__item' + active + '" data-tpl="' + esc(id) + '">' +
            '<strong>' + esc(t.name || id) + '</strong>' +
            '<span>' + esc(t.sampleSubject || id) + '</span>' +
            '<small>' + esc(t.senderRole || '') + (t.event ? ' · ' + esc(t.event) : '') + '</small>' +
          '</button>'
        );
      })
      .join('');

    list.querySelectorAll('[data-tpl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selected = btn.getAttribute('data-tpl');
        var entry = state.templates.find(function (x) { return (x.id || x.template) === state.selected; });
        state.dataJson = JSON.stringify(entry?.sampleData || {}, null, 2);
        var ta = document.getElementById('emailDataJson');
        if (ta) ta.value = state.dataJson;
        renderList();
        void loadPreview();
      });
    });
  }

  async function loadTemplates() {
    var res = await api('/api/admin/email-preview');
    if (!res.ok) throw new Error(res.data?.error || res.data?.message || 'list_failed');
    state.templates = res.data.templates || [];
    if (!state.selected && state.templates[0]) {
      state.selected = state.templates[0].id || state.templates[0].template;
      state.dataJson = JSON.stringify(state.templates[0].sampleData || {}, null, 2);
    }
    renderList();
    var ta = document.getElementById('emailDataJson');
    if (ta) ta.value = state.dataJson;
  }

  async function loadPreview() {
    var status = document.getElementById('emailPreviewStatus');
    var frame = document.getElementById('emailPreviewFrame');
    var meta = document.getElementById('emailPreviewMeta');
    if (!state.selected) return;
    var data = {};
    try {
      data = JSON.parse(document.getElementById('emailDataJson')?.value || state.dataJson || '{}');
    } catch (_e) {
      if (status) status.textContent = 'Invalid JSON in variables field.';
      return;
    }
    if (status) status.textContent = 'Rendering…';
    var q = new URLSearchParams({
      template: state.selected,
      data: JSON.stringify(data),
    });
    var res = await api('/api/admin/email-preview?' + q.toString());
    if (!res.ok) {
      if (status) status.textContent = 'Preview failed: ' + (res.data?.error || 'error');
      return;
    }
    state.preview = res.data.rendered || {
      subject: res.data.subject,
      preview: res.data.preview,
      html: res.data.html,
      text: res.data.text,
    };
    if (meta) {
      meta.innerHTML =
        '<p><strong>Subject:</strong> ' + esc(state.preview?.subject) + '</p>' +
        '<p><strong>Preview text:</strong> ' + esc(state.preview?.preview) + '</p>';
    }
    if (frame && state.preview?.html) {
      frame.srcdoc = state.preview.html;
    }
    if (status) status.textContent = 'Preview updated.';
  }

  async function sendTest() {
    var status = document.getElementById('emailPreviewStatus');
    var recipient = document.getElementById('emailTestRecipient')?.value?.trim();
    if (!state.selected || !recipient) {
      if (status) status.textContent = 'Select a template and enter a test recipient.';
      return;
    }
    var data = {};
    try {
      data = JSON.parse(document.getElementById('emailDataJson')?.value || '{}');
    } catch (_e) {
      if (status) status.textContent = 'Invalid JSON.';
      return;
    }
    if (status) status.textContent = 'Sending…';
    var res = await api('/api/admin/email-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: state.selected, recipient: recipient, data: data }),
    });
    if (status) {
      var result = res.data?.result || {};
      if (res.ok && result.sent) {
        status.textContent = 'Test email sent' + (result.messageId ? ' (id: ' + result.messageId + ')' : '') + '.';
      } else if (result.skipped) {
        status.textContent = 'Send skipped — Resend/SMTP not configured. Check /api/admin/email-debug.';
      } else {
        status.textContent = 'Send failed: ' + (res.data?.error || result.error || 'error');
      }
    }
  }

  function bindEvents() {
    document.getElementById('emailPreviewBtn')?.addEventListener('click', function () { void loadPreview(); });
    document.getElementById('emailSendTestBtn')?.addEventListener('click', function () { void sendTest(); });
  }

  function injectStyles() {
    if (document.getElementById('cutup-admin-email-preview-css')) return;
    var s = document.createElement('style');
    s.id = 'cutup-admin-email-preview-css';
    s.textContent =
      '.admin-email-preview__layout{display:grid;grid-template-columns:260px 1fr;gap:20px;min-height:70vh}' +
      '.admin-email-preview__list{display:flex;flex-direction:column;gap:8px;max-height:75vh;overflow:auto}' +
      '.admin-email-preview__item{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;text-align:left}' +
      '.admin-email-preview__item.is-active{border-color:#635bff;background:#f5f3ff}' +
      '.admin-email-preview__item strong{font-size:12px}' +
      '.admin-email-preview__item span{font-size:13px;color:#374151}' +
      '.admin-email-preview__item small{font-size:11px;color:#6b7280}' +
      '.admin-email-preview__frame{width:100%;min-height:520px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}' +
      '.admin-email-preview__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}' +
      '@media(max-width:900px){.admin-email-preview__layout{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  window.CutupAdminEmailPreview = {
    mount: async function (root) {
      if (!root) return;
      injectStyles();
      renderShell(root);
      bindEvents();
      try {
        await loadTemplates();
        await loadPreview();
      } catch (err) {
        root.querySelector('#emailPreviewStatus').textContent = 'Could not load templates: ' + (err?.message || err);
      }
    },
  };
})();
