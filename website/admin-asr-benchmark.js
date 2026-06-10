/**
 * Admin ASR benchmark UI — /adminha.html/asr-benchmark
 */
(function () {
  const ENGINE_LABELS = {
    'openai-whisper1': 'OpenAI whisper-1',
    'whisper-large-v3': 'Whisper Large V3',
    'whisper-large-v3-turbo': 'Whisper Large V3 Turbo'
  };

  function apiBase() {
    const b = window.CUTUP_API_BASE;
    return typeof b === 'string' ? b.replace(/\/$/, '') : '';
  }

  function apiUrl(path) {
    const p = path.charAt(0) === '/' ? path : `/${path}`;
    const base = apiBase();
    return base ? `${base}${p}` : p;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('asrBenchStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', Boolean(isError));
  }

  function renderProviders(report, engineResults) {
    const grid = document.getElementById('asrBenchGrid');
    if (!grid) return;
    const byId = {};
    for (const e of engineResults || []) byId[e.engineId] = e;

    grid.innerHTML = (report.providers || [])
      .map((p) => {
        const eng = byId[p.engineId] || {};
        const skipped = p.skipped || p.failed;
        return `
        <div class="asr-bench-col ${skipped ? 'asr-bench-skipped' : ''}">
          <div class="asr-bench-col-head">${escapeHtml(p.provider)}</div>
          <div class="asr-bench-col-stats">
            model: ${escapeHtml(p.model || 'n/a')} · words: ${p.wordCount ?? 0} · segments: ${p.segmentCount ?? 0}
            · avg conf: ${p.avgConfidence ?? 'n/a'} · coverage: ${p.transcriptCoverageRatio ?? 'n/a'}
            ${p.error ? `<br>status: ${escapeHtml(p.error)}` : ''}
          </div>
          <div class="asr-bench-col-body">${escapeHtml(eng.text || '(empty)')}</div>
        </div>`;
      })
      .join('');
  }

  function renderDifferences(report) {
    const host = document.getElementById('asrBenchDiffs');
    if (!host) return;
    const diffs = report.differences || [];
    if (!diffs.length) {
      host.innerHTML = '<p class="asr-bench-status">No timeline differences between active engines.</p>';
      return;
    }

    host.innerHTML = `<div class="asr-bench-diff-list">${diffs
      .map((d) => {
        const rows = Object.keys(ENGINE_LABELS)
          .map((id) => {
            const missing = d.missingWordsByEngine?.[id];
            return `
            <div class="asr-bench-diff-row">
              <strong>${escapeHtml(ENGINE_LABELS[id])}:</strong>
              "${escapeHtml(d[id] || '')}"
              ${
                missing?.length
                  ? `<div class="asr-bench-missing">missing vs others: ${escapeHtml(missing.join(', '))}</div>`
                  : ''
              }
            </div>`;
          })
          .join('');
        return `
        <div class="asr-bench-diff-card">
          <h4>Timestamp ${escapeHtml(d.timestamp)}</h4>
          ${rows}
        </div>`;
      })
      .join('')}</div>`;
  }

  function renderMeta(result) {
    const meta = document.getElementById('asrBenchMeta');
    if (!meta) return;
    meta.innerHTML = `
      <span>trace: ${escapeHtml(result.traceId)}</span>
      <span>duration: ${result.report?.audioDuration ?? 'n/a'}s</span>
      <span>artifacts: ${escapeHtml(result.artifactDir || '')}</span>
    `;
  }

  async function runBenchmark() {
    const fileInput = document.getElementById('asrBenchFile');
    const langInput = document.getElementById('asrBenchLang');
    const file = fileInput?.files?.[0];
    if (!file) {
      setStatus('Choose a video or audio file first.', true);
      return;
    }

    setStatus('Running all ASR engines on the same extracted audio…');
    const btn = document.getElementById('asrBenchRunBtn');
    if (btn) btn.disabled = true;

    try {
      const fd = new FormData();
      fd.append('file', file);
      const hint = langInput?.value?.trim();
      if (hint) fd.append('languageHint', hint);

      const res = await fetch(apiUrl('/api/admin/asr-benchmark'), {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }

      renderMeta(data);
      renderProviders(data.report, data.engineResults);
      renderDifferences(data.report);
      const summaryEl = document.getElementById('asrBenchSummary');
      if (summaryEl) summaryEl.textContent = data.summaryText || '';
      setStatus('Benchmark complete.');
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function mount() {
    const root = document.getElementById('asrBenchWorkspace');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';

    document.getElementById('asrBenchRunBtn')?.addEventListener('click', () => {
      runBenchmark().catch((e) => setStatus(e.message, true));
    });
  }

  window.CutupAdminAsrBenchmark = { mount, runBenchmark };
})();
