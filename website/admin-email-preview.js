/**
 * Admin — Email Center (template preview + test send).
 */
(function () {
  'use strict';

  var FROM_BY_ROLE = {
    billing: 'Cutup Billing <billing@cutup.shop>',
    security: 'Cutup Security <security@cutup.shop>',
    support: 'Cutup Support <support@cutup.shop>',
    hello: 'Cutup <hello@cutup.shop>',
    info: 'Cutup <info@cutup.shop>',
    default: 'Cutup <noreply@cutup.shop>',
  };

  var CATEGORY_BY_ROLE = {
    billing: 'Billing',
    support: 'Support',
    security: 'Security',
    hello: 'Account',
    info: 'System',
    default: 'System',
  };

  var CATEGORIES = ['All', 'Billing', 'Support', 'Security', 'Account', 'System'];

  var state = {
    templates: [],
    selected: null,
    preview: null,
    dataJson: '{}',
    tab: 'preview',
    viewMode: 'desktop',
    templateSearch: '',
    categoryFilter: 'All',
    previewLoading: false,
    lastRenderedAt: null,
    renderDurationMs: null,
    buildVersion: null,
    sendTab: 'single',
    bulkPlan: 'free',
    excludeAlreadySent: true,
    audienceStats: null,
    bulkJob: null,
  };

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

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'ec-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(true);
    } catch (_e) {
      document.body.removeChild(ta);
      return Promise.resolve(false);
    }
  }

  function getCategory(tpl) {
    var role = String(tpl?.senderRole || 'default').toLowerCase();
    return CATEGORY_BY_ROLE[role] || 'System';
  }

  function getBadgeClass(category) {
    return 'ec-badge--' + String(category || 'system').toLowerCase();
  }

  function getFromAddress(tpl) {
    var role = String(tpl?.senderRole || 'default').toLowerCase();
    return FROM_BY_ROLE[role] || FROM_BY_ROLE.default;
  }

  function getDescription(tpl) {
    if (!tpl) return '';
    return tpl.sampleSubject || tpl.event || tpl.template || tpl.id || '';
  }

  function filteredTemplates() {
    var q = state.templateSearch.trim().toLowerCase();
    var cat = state.categoryFilter;
    return state.templates.filter(function (t) {
      var id = t.id || t.template;
      var name = String(t.name || id).toLowerCase();
      var desc = String(getDescription(t)).toLowerCase();
      var category = getCategory(t);
      if (cat !== 'All' && category !== cat) return false;
      if (!q) return true;
      return name.indexOf(q) >= 0 || desc.indexOf(q) >= 0 || String(id).toLowerCase().indexOf(q) >= 0;
    });
  }

  function selectedTemplate() {
    return state.templates.find(function (x) {
      return (x.id || x.template) === state.selected;
    });
  }

  function renderTabs() {
    var previewActive = state.tab === 'preview' ? ' is-active' : '';
    var logsActive = state.tab === 'logs' ? ' is-active' : '';
    return (
      '<nav class="ec-tabs" aria-label="Email sections">' +
        '<button type="button" class="ec-tabs__btn' + previewActive + '" data-email-tab="preview">Templates</button>' +
        '<button type="button" class="ec-tabs__btn' + logsActive + '" data-email-tab="logs">Delivery Logs</button>' +
      '</nav>'
    );
  }

  function renderCategoryBar() {
    return (
      '<div class="ec-category-bar" role="group" aria-label="Template categories">' +
        CATEGORIES.map(function (cat) {
          var active = state.categoryFilter === cat ? ' is-active' : '';
          return '<button type="button" class="ec-category-bar__chip' + active + '" data-email-category="' + esc(cat) + '">' + esc(cat) + '</button>';
        }).join('') +
      '</div>'
    );
  }

  function renderTemplateList() {
    if (state.previewLoading && !state.templates.length) {
      return Array(4).fill('<div class="ec-skeleton ec-skeleton-card"></div>').join('');
    }
    var items = filteredTemplates();
    if (!items.length) {
      return (
        '<div class="ec-empty">' +
          '<p class="ec-empty__title">No templates match</p>' +
          '<p class="ec-empty__desc">Try a different search or category filter.</p>' +
        '</div>'
      );
    }
    return items.map(function (t) {
      var id = t.id || t.template;
      var active = state.selected === id ? ' is-active' : '';
      var category = getCategory(t);
      return (
        '<button type="button" class="ec-template-card' + active + '" data-tpl="' + esc(id) + '">' +
          '<span class="ec-template-card__name">' + esc(t.name || id) + '</span>' +
          '<span class="ec-template-card__desc">' + esc(getDescription(t)) + '</span>' +
          '<span class="ec-badge ' + getBadgeClass(category) + '">' + esc(category) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderMetaPills() {
    var tpl = selectedTemplate();
    var p = state.preview || {};
    var pills = [
      { label: 'Subject', value: p.subject || '—' },
      { label: 'Preview Text', value: p.preview || '—' },
      { label: 'From Address', value: tpl ? getFromAddress(tpl) : '—' },
      { label: 'Category', value: tpl ? getCategory(tpl) : '—' },
      { label: 'Last Rendered', value: state.lastRenderedAt ? new Date(state.lastRenderedAt).toLocaleString() : '—' },
      { label: 'Build Version', value: state.buildVersion || '—' },
      { label: 'Render Duration', value: state.renderDurationMs != null ? state.renderDurationMs + ' ms' : '—' },
    ];
    return pills.map(function (pill) {
      var title = pill.value && pill.value !== '—' ? ' title="' + esc(pill.value) + '"' : '';
      return (
        '<div class="ec-meta-pill">' +
          '<span class="ec-meta-pill__label">' + esc(pill.label) + '</span>' +
          '<span class="ec-meta-pill__value"' + title + '>' + esc(pill.value) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderSendDistribution() {
    var excludeChecked = state.excludeAlreadySent ? ' checked' : '';
    var singleActive = state.sendTab === 'single' ? ' is-active' : '';
    var planActive = state.sendTab === 'plan' ? ' is-active' : '';
    var allActive = state.sendTab === 'all' ? ' is-active' : '';
    var stats = state.audienceStats;
    var statsHtml = '';
    if (stats && (state.sendTab === 'plan' || state.sendTab === 'all')) {
      statsHtml =
        '<p class="ec-audience-stats">' +
          esc(String(stats.matchedUsers || 0)) + ' will receive · ' +
          esc(String(stats.skippedAlreadySent || 0)) + ' already sent · ' +
          esc(String(stats.totalInScope || 0)) + ' in audience' +
        '</p>';
    }
    return (
      '<article class="ec-send-card">' +
        '<h3 class="ec-send-card__title">Send to audience</h3>' +
        '<p class="ec-muted ec-send-card__lead">Send the selected template to one user, a plan group, or everyone.</p>' +
        '<div class="ec-send-tabs" role="tablist">' +
          '<button type="button" class="ec-send-tab' + singleActive + '" data-email-send-tab="single">Single user</button>' +
          '<button type="button" class="ec-send-tab' + planActive + '" data-email-send-tab="plan">By plan</button>' +
          '<button type="button" class="ec-send-tab' + allActive + '" data-email-send-tab="all">Broadcast all</button>' +
        '</div>' +
        '<div class="ec-send-panel' + (state.sendTab === 'single' ? ' is-active' : '') + '" data-email-send-panel="single">' +
          '<label class="ec-field-label" for="emailTestRecipient">Recipient email</label>' +
          '<input type="email" id="emailTestRecipient" class="ec-input" placeholder="user@example.com" />' +
          '<p class="ec-recipient-help">Profile name replaces sample values like Alex when sending.</p>' +
          '<div class="ec-recipient-actions">' +
            '<button type="button" class="ec-btn" id="emailLoadProfileBtn">Load profile into preview</button>' +
            '<button type="button" class="ec-btn ec-btn--primary" id="emailSendSingleBtn">Send Email</button>' +
          '</div>' +
          '<p id="emailRecipientStatus" class="ec-recipient-status ec-muted"></p>' +
        '</div>' +
        '<div class="ec-send-panel' + (state.sendTab === 'plan' ? ' is-active' : '') + '" data-email-send-panel="plan">' +
          '<label class="ec-field-label" for="emailBulkPlan">Plan</label>' +
          '<select id="emailBulkPlan" class="ec-input">' +
            ['free', 'starter', 'pro', 'business'].map(function (p) {
              var sel = state.bulkPlan === p ? ' selected' : '';
              var label = p.charAt(0).toUpperCase() + p.slice(1);
              return '<option value="' + esc(p) + '"' + sel + '>' + esc(label) + '</option>';
            }).join('') +
          '</select>' +
          '<label class="ec-distribution-option">' +
            '<input type="checkbox" id="emailExcludeAlreadySentPlan"' + excludeChecked + '>' +
            'Skip users who already received this template' +
          '</label>' +
          statsHtml +
          '<button type="button" class="ec-btn ec-btn--primary" id="emailSendPlanBtn">Send to plan</button>' +
        '</div>' +
        '<div class="ec-send-panel' + (state.sendTab === 'all' ? ' is-active' : '') + '" data-email-send-panel="all">' +
          '<p class="ec-muted">Send this template to every user with an email address.</p>' +
          '<label class="ec-distribution-option">' +
            '<input type="checkbox" id="emailExcludeAlreadySentAll"' + excludeChecked + '>' +
            'Skip users who already received this template' +
          '</label>' +
          statsHtml +
          '<button type="button" class="ec-btn ec-btn--primary" id="emailSendAllBtn">Broadcast email</button>' +
        '</div>' +
        '<div id="emailBulkJobHost"></div>' +
      '</article>'
    );
  }

  function renderPreviewPanel() {
    var desktopActive = state.viewMode === 'desktop' ? ' is-active' : '';
    var mobileActive = state.viewMode === 'mobile' ? ' is-active' : '';
    var surfaceClass = state.viewMode === 'mobile' ? 'ec-preview-surface--mobile' : 'ec-preview-surface--desktop';
    var frameContent = state.previewLoading
      ? '<div class="ec-skeleton" style="height:520px;border-radius:12px"></div>'
      : '<iframe id="emailPreviewFrame" class="ec-preview-frame" title="Email preview"></iframe>';

    return (
      '<div class="ec-preview-layout">' +
        '<aside class="ec-sidebar">' +
          '<input type="search" class="ec-input ec-sidebar__search" id="emailTemplateSearch" placeholder="Search templates…" value="' + esc(state.templateSearch) + '" />' +
          renderCategoryBar() +
          '<div class="ec-template-list" id="emailTemplateList">' + renderTemplateList() + '</div>' +
        '</aside>' +
        '<div class="ec-workspace">' +
          '<div class="ec-toolbar">' +
            '<div class="ec-toolbar__actions">' +
              '<button type="button" class="ec-btn" id="emailPreviewBtn">Refresh Preview</button>' +
              '<button type="button" class="ec-btn" id="emailCopyHtmlBtn">Copy HTML</button>' +
            '</div>' +
            '<div class="ec-segment" role="group" aria-label="Preview size">' +
              '<button type="button" class="ec-segment__btn' + desktopActive + '" data-view-mode="desktop">Desktop</button>' +
              '<button type="button" class="ec-segment__btn' + mobileActive + '" data-view-mode="mobile">Mobile</button>' +
            '</div>' +
          '</div>' +
          '<div class="ec-vars-grid">' +
            '<div class="ec-code-editor">' +
              '<div class="ec-code-editor__head">' +
                '<span class="ec-code-editor__title">Variables JSON</span>' +
                '<span class="ec-code-editor__hint">Preview only — sends use each user&apos;s profile</span>' +
              '</div>' +
              '<textarea id="emailDataJson" class="ec-code-editor__textarea" spellcheck="false" rows="10"></textarea>' +
            '</div>' +
          '</div>' +
          renderSendDistribution() +
          '<p id="emailPreviewStatus" class="ec-status-line ec-muted"></p>' +
          '<div class="ec-meta" id="emailPreviewMeta">' + renderMetaPills() + '</div>' +
          '<div class="ec-preview-card">' +
            '<div class="ec-preview-surface ' + surfaceClass + '" id="emailPreviewSurface">' + frameContent + '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderShell(root) {
    root.innerHTML =
      '<div class="ec-root admin-email-preview">' +
        '<header class="ec-page-head">' +
          '<h2>Emails</h2>' +
          '<p class="ec-muted">Preview templates, send emails to users, and review delivery logs.</p>' +
        '</header>' +
        renderTabs() +
        '<div id="emailTabPreview"' + (state.tab === 'preview' ? '' : ' hidden') + '>' +
          renderPreviewPanel() +
        '</div>' +
        '<div id="emailTabLogs"' + (state.tab === 'logs' ? '' : ' hidden') + '></div>' +
      '</div>';
  }

  function refreshSidebarDom() {
    var list = document.getElementById('emailTemplateList');
    if (list) list.innerHTML = renderTemplateList();
    bindTemplateCards();
  }

  function refreshMetaDom() {
    var meta = document.getElementById('emailPreviewMeta');
    if (meta) meta.innerHTML = renderMetaPills();
  }

  function setViewMode(mode) {
    state.viewMode = mode === 'mobile' ? 'mobile' : 'desktop';
    var surface = document.getElementById('emailPreviewSurface');
    if (!surface) return;
    surface.className = 'ec-preview-surface ' + (state.viewMode === 'mobile' ? 'ec-preview-surface--mobile' : 'ec-preview-surface--desktop');
    document.querySelectorAll('[data-view-mode]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-view-mode') === state.viewMode);
    });
  }

  function bindTemplateCards() {
    document.querySelectorAll('[data-tpl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selected = btn.getAttribute('data-tpl');
        var entry = selectedTemplate();
        state.dataJson = JSON.stringify(entry?.sampleData || {}, null, 2);
        var ta = document.getElementById('emailDataJson');
        if (ta) ta.value = state.dataJson;
        refreshSidebarDom();
        void loadPreview();
        if (state.sendTab !== 'single') void refreshAudienceStats();
      });
    });
  }

  async function switchTab(tab) {
    state.tab = tab === 'logs' ? 'logs' : 'preview';
    var previewHost = document.getElementById('emailTabPreview');
    var logsHost = document.getElementById('emailTabLogs');
    document.querySelectorAll('[data-email-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-email-tab') === state.tab);
    });
    if (previewHost) previewHost.hidden = state.tab !== 'preview';
    if (logsHost) logsHost.hidden = state.tab !== 'logs';
    if (state.tab === 'logs' && logsHost && window.CutupAdminEmailDeliveryLog?.mount) {
      await window.CutupAdminEmailDeliveryLog.mount(logsHost);
      return;
    }
    if (state.tab === 'preview') {
      try {
        await loadTemplates();
        await loadPreview();
      } catch (err) {
        var status = document.getElementById('emailPreviewStatus');
        if (status) status.textContent = 'Could not load templates: ' + (err?.message || err);
      }
    }
  }

  async function loadTemplates() {
    var res = await api('/api/admin/email-preview');
    if (!res.ok) throw new Error(res.data?.error || res.data?.message || 'list_failed');
    state.templates = res.data.templates || [];
    if (!state.selected && state.templates[0]) {
      state.selected = state.templates[0].id || state.templates[0].template;
      state.dataJson = JSON.stringify(state.templates[0].sampleData || {}, null, 2);
    }
    refreshSidebarDom();
    var ta = document.getElementById('emailDataJson');
    if (ta) ta.value = state.dataJson;
  }

  async function tryLoadBuildVersion() {
    try {
      var res = await fetch(apiBase() + '/api/admin/email-debug', { credentials: 'include' });
      if (!res.ok) return;
      var data = await res.json().catch(function () { return {}; });
      var stamp = data?.platform?.buildStamp || data?.buildStamp || data?.bundle?.version;
      if (stamp) state.buildVersion = String(stamp);
    } catch (_e) {
      /* optional */
    }
  }

  async function loadPreview() {
    var status = document.getElementById('emailPreviewStatus');
    var surface = document.getElementById('emailPreviewSurface');
    if (!state.selected) return;

    var data = {};
    try {
      data = JSON.parse(document.getElementById('emailDataJson')?.value || state.dataJson || '{}');
    } catch (_e) {
      if (status) status.textContent = 'Invalid JSON in variables field.';
      return;
    }

    state.previewLoading = true;
    if (status) status.textContent = 'Rendering…';
    if (surface && !document.getElementById('emailPreviewFrame')) {
      surface.innerHTML = '<div class="ec-skeleton" style="height:520px;border-radius:12px"></div>';
    }

    var t0 = performance.now();
    var q = new URLSearchParams({
      template: state.selected,
      data: JSON.stringify(data),
    });
    var res = await api('/api/admin/email-preview?' + q.toString());
    state.previewLoading = false;

    if (!res.ok) {
      if (status) status.textContent = 'Preview failed: ' + (res.data?.error || 'error');
      if (surface) {
        surface.innerHTML = (
          '<div class="ec-empty">' +
            '<p class="ec-empty__title">Preview unavailable</p>' +
            '<p class="ec-empty__desc">' + esc(res.data?.error || 'Could not render template.') + '</p>' +
          '</div>'
        );
      }
      return;
    }

    state.preview = res.data.rendered || {
      subject: res.data.subject,
      preview: res.data.preview,
      html: res.data.html,
      text: res.data.text,
    };
    state.lastRenderedAt = Date.now();
    state.renderDurationMs = Math.round(performance.now() - t0);

    refreshMetaDom();

    if (surface) {
      var modeClass = state.viewMode === 'mobile' ? 'ec-preview-surface--mobile' : 'ec-preview-surface--desktop';
      surface.className = 'ec-preview-surface ' + modeClass;
      surface.innerHTML = '<iframe id="emailPreviewFrame" class="ec-preview-frame" title="Email preview"></iframe>';
    }
    var frame = document.getElementById('emailPreviewFrame');
    if (frame && state.preview?.html) {
      frame.srcdoc = state.preview.html;
    }
    if (status) status.textContent = 'Preview updated.';
  }

  var bulkDangerArmed = null;

  function armBulkBroadcast() {
    bulkDangerArmed = Date.now() + 4000;
  }

  function isBulkBroadcastArmed() {
    return bulkDangerArmed && bulkDangerArmed > Date.now();
  }

  function parseVariablesJson() {
    try {
      return JSON.parse(document.getElementById('emailDataJson')?.value || state.dataJson || '{}');
    } catch (_e) {
      return null;
    }
  }

  function syncExcludeAlreadySent() {
    var planBox = document.getElementById('emailExcludeAlreadySentPlan');
    var allBox = document.getElementById('emailExcludeAlreadySentAll');
    if (planBox) state.excludeAlreadySent = planBox.checked;
    if (allBox) allBox.checked = state.excludeAlreadySent;
    if (planBox) planBox.checked = state.excludeAlreadySent;
  }

  async function refreshAudienceStats() {
    if (!state.selected || state.sendTab === 'single') return;
    var mode = state.sendTab === 'plan' ? 'plan' : 'all';
    syncExcludeAlreadySent();
    var plan = document.getElementById('emailBulkPlan')?.value || state.bulkPlan || 'free';
    state.bulkPlan = plan;
    var q = new URLSearchParams({
      action: 'audience-stats',
      template: state.selected,
      mode: mode,
      plan: plan,
      excludeAlreadySent: state.excludeAlreadySent ? 'true' : 'false',
    });
    var res = await api('/api/admin/email-preview?' + q.toString());
    if (res.ok && res.data?.audience) {
      state.audienceStats = res.data.audience;
      refreshSendDistributionDom();
    }
  }

  function refreshSendDistributionDom() {
    var host = document.querySelector('.ec-send-card');
    if (!host) return;
    var parent = host.parentNode;
    var next = host.nextSibling;
    host.remove();
    var wrap = document.createElement('div');
    wrap.innerHTML = renderSendDistribution();
    var newCard = wrap.firstElementChild;
    if (parent) parent.insertBefore(newCard, next);
    bindSendDistributionEvents();
  }

  function renderBulkJobStatus(job) {
    var host = document.getElementById('emailBulkJobHost');
    if (!host) return;
    if (!job) {
      host.innerHTML = '';
      return;
    }
    var pct = job.status === 'queued' ? 15 : job.status === 'running' ? 55 : 100;
    host.innerHTML =
      '<div class="ec-bulk-job">' +
        '<strong>Bulk send:</strong> ' + esc(job.status) +
        (job.error ? '<div>' + esc(job.error) + '</div>' : '') +
        (job.result
          ? '<div>Sent: ' + esc(String(job.result.sent || 0)) +
            ' · Failed: ' + esc(String(job.result.failed || 0)) +
            ' · Skipped (transport): ' + esc(String(job.result.skipped || 0)) +
            '</div>'
          : '') +
        '<div class="ec-bulk-job__bar"><i style="width:' + pct + '%"></i></div>' +
      '</div>';
  }

  async function waitForEmailJob(jobId, timeoutMs) {
    var started = Date.now();
    while (Date.now() - started < timeoutMs) {
      var res = await api('/api/admin/email-preview?action=job&jobId=' + encodeURIComponent(jobId));
      if (!res.ok) throw new Error(res.data?.error || 'job_not_found');
      var job = res.data.job;
      renderBulkJobStatus(job);
      if (job.status === 'completed' || job.status === 'failed') return job;
      await new Promise(function (r) { setTimeout(r, 800); });
    }
    throw new Error('Bulk send timed out');
  }

  async function sendBulk(mode) {
    var status = document.getElementById('emailPreviewStatus');
    if (!state.selected) {
      if (status) status.textContent = 'Select a template first.';
      return;
    }
    var data = parseVariablesJson();
    if (!data) {
      if (status) status.textContent = 'Invalid JSON in variables field.';
      return;
    }
    syncExcludeAlreadySent();
    var plan = document.getElementById('emailBulkPlan')?.value || state.bulkPlan || 'free';
    if (mode === 'all' && !isBulkBroadcastArmed()) {
      armBulkBroadcast();
      if (status) status.textContent = 'Click Broadcast email again within 4 seconds to confirm.';
      return;
    }
    bulkDangerArmed = null;
    if (status) status.textContent = 'Starting bulk send…';
    var res = await api('/api/admin/email-preview?action=send-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: state.selected,
        mode: mode,
        plan: plan,
        excludeAlreadySent: state.excludeAlreadySent,
        data: data,
      }),
    });
    if (!res.ok || !res.data?.jobId) {
      if (status) status.textContent = 'Bulk send failed: ' + (res.data?.error || 'error');
      return;
    }
    try {
      var job = await waitForEmailJob(res.data.jobId, 600000);
      if (job.status === 'completed') {
        var sent = Number(job.result?.sent || 0);
        if (status) {
          status.textContent = sent > 0
            ? 'Bulk send complete — ' + sent + ' emails sent.'
            : 'Bulk send complete — no new recipients matched.';
        }
        toast(sent > 0 ? 'Bulk send complete' : 'No recipients matched');
        void refreshAudienceStats();
        if (window.CutupAdminEmailDeliveryLog?.reload) window.CutupAdminEmailDeliveryLog.reload();
      } else {
        if (status) status.textContent = 'Bulk send failed: ' + (job.error || 'unknown');
      }
    } catch (err) {
      if (status) status.textContent = err.message || 'Bulk send failed';
    }
  }

  function bindSendDistributionEvents() {
    document.querySelectorAll('[data-email-send-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sendTab = btn.getAttribute('data-email-send-tab') || 'single';
        refreshSendDistributionDom();
        if (state.sendTab !== 'single') void refreshAudienceStats();
      });
    });
    document.getElementById('emailBulkPlan')?.addEventListener('change', function () {
      state.bulkPlan = document.getElementById('emailBulkPlan')?.value || 'free';
      void refreshAudienceStats();
    });
    document.getElementById('emailExcludeAlreadySentPlan')?.addEventListener('change', function () {
      state.excludeAlreadySent = document.getElementById('emailExcludeAlreadySentPlan')?.checked !== false;
      var allBox = document.getElementById('emailExcludeAlreadySentAll');
      if (allBox) allBox.checked = state.excludeAlreadySent;
      void refreshAudienceStats();
    });
    document.getElementById('emailExcludeAlreadySentAll')?.addEventListener('change', function () {
      state.excludeAlreadySent = document.getElementById('emailExcludeAlreadySentAll')?.checked !== false;
      var planBox = document.getElementById('emailExcludeAlreadySentPlan');
      if (planBox) planBox.checked = state.excludeAlreadySent;
      void refreshAudienceStats();
    });
    document.getElementById('emailSendSingleBtn')?.addEventListener('click', function () { void sendTest(); });
    document.getElementById('emailLoadProfileBtn')?.addEventListener('click', function () { void loadRecipientProfile(); });
    document.getElementById('emailSendPlanBtn')?.addEventListener('click', function () { void sendBulk('plan'); });
    document.getElementById('emailSendAllBtn')?.addEventListener('click', function () { void sendBulk('all'); });
  }

  async function loadRecipientProfile() {
    var status = document.getElementById('emailRecipientStatus');
    var recipient = document.getElementById('emailTestRecipient')?.value?.trim();
    if (!recipient) {
      if (status) status.textContent = 'Enter a recipient email first.';
      return;
    }
    if (status) status.textContent = 'Loading profile…';
    var res = await api('/api/admin/email-preview?action=recipient-data&email=' + encodeURIComponent(recipient));
    if (!res.ok || !res.data?.profile) {
      if (status) status.textContent = 'Could not load profile for this email.';
      return;
    }
    var profile = res.data.profile;
    var current = {};
    try {
      current = JSON.parse(document.getElementById('emailDataJson')?.value || state.dataJson || '{}');
    } catch (_e) {
      current = {};
    }
    var merged = Object.assign({}, current, {
      firstName: profile.firstName,
      lastName: profile.lastName || current.lastName,
      email: profile.email,
      planName: profile.planName || current.planName,
    });
    state.dataJson = JSON.stringify(merged, null, 2);
    var ta = document.getElementById('emailDataJson');
    if (ta) ta.value = state.dataJson;
    if (status) {
      status.textContent = profile.userFound
        ? 'Loaded profile for ' + profile.firstName + '. Refresh preview to see it.'
        : 'No account found — using name inferred from email (' + profile.firstName + ').';
    }
    void loadPreview();
  }

  async function sendTest() {
    var status = document.getElementById('emailPreviewStatus');
    var recipient = document.getElementById('emailTestRecipient')?.value?.trim();
    if (!state.selected || !recipient) {
      if (status) status.textContent = 'Select a template and enter a recipient email.';
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
      body: JSON.stringify({
        template: state.selected,
        recipient: recipient,
        data: data,
        useRecipientProfile: true,
      }),
    });
    if (status) {
      var result = res.data?.result || {};
      var sentData = res.data?.data || {};
      if (res.ok && result.sent) {
        status.textContent = 'Email sent to ' + recipient + ' as ' + (sentData.firstName || 'recipient') +
          (result.messageId ? ' (id: ' + result.messageId + ')' : '') + '.';
        toast('Email sent');
        if (window.CutupAdminEmailDeliveryLog?.reload) window.CutupAdminEmailDeliveryLog.reload();
      } else if (result.skipped) {
        status.textContent = 'Send skipped — Resend/SMTP not configured.';
      } else {
        status.textContent = 'Send failed: ' + (res.data?.error || result.error || 'error');
      }
    }
  }

  async function copyHtml() {
    var html = state.preview?.html;
    if (!html) {
      toast('No HTML to copy');
      return;
    }
    var ok = await copyText(html);
    toast(ok ? 'HTML copied' : 'Copy failed');
  }

  var onSearchInput = debounce(function () {
    state.templateSearch = document.getElementById('emailTemplateSearch')?.value || '';
    refreshSidebarDom();
  }, 350);

  function bindEvents() {
    document.querySelectorAll('[data-email-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        void switchTab(btn.getAttribute('data-email-tab'));
      });
    });

    document.getElementById('emailPreviewBtn')?.addEventListener('click', function () { void loadPreview(); });
    document.getElementById('emailCopyHtmlBtn')?.addEventListener('click', function () { void copyHtml(); });
    bindSendDistributionEvents();

    document.getElementById('emailTemplateSearch')?.addEventListener('input', onSearchInput);

    document.querySelectorAll('[data-email-category]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.categoryFilter = btn.getAttribute('data-email-category') || 'All';
        document.querySelectorAll('[data-email-category]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        refreshSidebarDom();
      });
    });

    document.querySelectorAll('[data-view-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.getAttribute('data-view-mode'));
      });
    });

    bindTemplateCards();
  }

  function ensureStyles() {
    if (document.getElementById('cutup-admin-email-center-css')) return;
    var link = document.createElement('link');
    link.id = 'cutup-admin-email-center-css';
    link.rel = 'stylesheet';
    link.href = 'admin-email-center.css?v=20260602-email-v1';
    document.head.appendChild(link);
  }

  window.CutupAdminEmailPreview = {
    mount: async function (root) {
      if (!root) return;
      ensureStyles();
      renderShell(root);
      bindEvents();
      void tryLoadBuildVersion();
      await switchTab('preview');
    },
  };
})();
