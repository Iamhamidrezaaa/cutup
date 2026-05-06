/**
 * Unified editor state — single source of truth (idle | dirty | saving | saved | error).
 */
window.CutupCmsEditorState = (function () {
  const STATES = new Set(['idle', 'dirty', 'saving', 'saved', 'error']);
  let baseline = null;
  let state = 'idle';
  let errorMessage = '';

  function stableStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch {
      return '';
    }
  }

  function setState(next, opts = {}) {
    const s = STATES.has(next) ? next : 'idle';
    state = s;
    if (opts.message) errorMessage = String(opts.message);
    if (s !== 'error') errorMessage = '';
    syncIndicator();
  }

  function capture(snapshot) {
    baseline = stableStringify(snapshot);
    setState('saved');
  }

  function markDirty() {
    if (!baseline) return;
    if (state === 'saving') return;
    setState('dirty');
  }

  function markClean(snapshot) {
    if (snapshot) {
      baseline = stableStringify(snapshot);
      setState('saved');
    } else {
      setState('idle');
    }
  }

  function isDirty() {
    return state === 'dirty';
  }

  function getState() {
    return state;
  }

  function check(currentSnapshot) {
    if (!baseline || state === 'saving') return state === 'dirty';
    const now = stableStringify(currentSnapshot);
    const changed = now !== baseline;
    if (changed && state !== 'saving') setState('dirty');
    else if (!changed && state === 'dirty') setState('saved');
    return changed;
  }

  function syncIndicator() {
    const el = document.querySelector('[data-cms-save-status]');
    if (!el) return;
    const labels = {
      idle: '',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      saved: 'Saved',
      error: errorMessage || 'Save failed'
    };
    el.textContent = labels[state] || '';
    el.dataset.state = state;
    el.classList.toggle('cms-save-status--badge', state !== 'idle' && state !== '');
  }

  function setSaving(isSaving) {
    if (isSaving) setState('saving');
    else if (state === 'saving') setState(baseline && isDirty() ? 'dirty' : 'saved');
  }

  function setSavedJustNow() {
    setState('saved');
  }

  function setError(message) {
    setState('error', { message: message || 'Save failed' });
  }

  function reset() {
    baseline = null;
    errorMessage = '';
    setState('idle');
  }

  function showLeaveModal() {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'cms-unsaved-backdrop';
      backdrop.innerHTML = `<div class="cms-unsaved-modal" role="dialog" aria-modal="true" aria-labelledby="cmsUnsavedTitle">
        <h2 id="cmsUnsavedTitle">Unsaved changes</h2>
        <p>You have unsaved changes. What would you like to do?</p>
        <div class="cms-unsaved-actions">
          <button type="button" class="btn" data-leave-save>Save &amp; leave</button>
          <button type="button" class="btn ghost" data-leave-discard>Discard</button>
          <button type="button" class="btn ghost" data-leave-cancel>Cancel</button>
        </div>
      </div>`;
      document.body.appendChild(backdrop);
      const done = (v) => {
        backdrop.remove();
        resolve(v);
      };
      backdrop.querySelector('[data-leave-save]')?.addEventListener('click', () => done('save'));
      backdrop.querySelector('[data-leave-discard]')?.addEventListener('click', () => done('discard'));
      backdrop.querySelector('[data-leave-cancel]')?.addEventListener('click', () => done('cancel'));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) done('cancel');
      });
    });
  }

  async function confirmLeave(saveFn) {
    if (!isDirty()) return 'leave';
    const choice = await showLeaveModal();
    if (choice === 'cancel') return 'cancel';
    if (choice === 'discard') return 'leave';
    if (choice === 'save' && typeof saveFn === 'function') {
      try {
        await saveFn();
      } catch (e) {
        setError(e?.message || 'Save failed');
        return 'cancel';
      }
      check();
      return isDirty() ? 'cancel' : 'leave';
    }
    return 'cancel';
  }

  const api = {
    capture,
    markDirty,
    markClean,
    isDirty,
    check,
    getState,
    setState,
    reset,
    setSaving,
    setSavedJustNow,
    setError,
    confirmLeave
  };

  window.editorState = api;
  return api;
})();
