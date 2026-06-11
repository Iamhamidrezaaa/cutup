/**
 * Minimal post-job feedback (transcription / translation / export).
 */
(function (global) {
  'use strict';

  const FADE_MS = 280;
  const THANKS_MS = 1600;
  const SHOW_DELAY_MS = 1400;

  let root = null;
  let pending = null;

  function getSessionId() {
    if (typeof global.getCutupSessionId === 'function') return global.getCutupSessionId();
    return global.localStorage?.getItem('cutup_session') || null;
  }

  function dedupeKey(action, contextKey) {
    return `cutup_pf_${action}_${contextKey}`;
  }

  function wasShown(action, contextKey) {
    try {
      return Boolean(global.sessionStorage?.getItem(dedupeKey(action, contextKey)));
    } catch {
      return false;
    }
  }

  function markShown(action, contextKey) {
    try {
      global.sessionStorage?.setItem(dedupeKey(action, contextKey), '1');
    } catch {
      /* ignore */
    }
  }

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'cutupPipelineFeedback';
    root.className = 'cutup-pipeline-feedback';
    root.hidden = true;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
    return root;
  }

  function fadeOut(el, done) {
    if (!el) {
      done?.();
      return;
    }
    el.classList.add('is-fading');
    global.setTimeout(() => {
      el.classList.remove('is-fading');
      el.hidden = true;
      done?.();
    }, FADE_MS);
  }

  function renderPrompt(el, action) {
    el.innerHTML = `
      <div class="cutup-pipeline-feedback__prompt">
        <p class="cutup-pipeline-feedback__question">How did it go?</p>
        <div class="cutup-pipeline-feedback__actions">
          <button type="button" class="cutup-pipeline-feedback__btn cutup-pipeline-feedback__btn--up" data-rating="up" aria-label="Good">👍</button>
          <button type="button" class="cutup-pipeline-feedback__btn cutup-pipeline-feedback__btn--down" data-rating="down" aria-label="Not good">👎</button>
        </div>
      </div>
    `;
    el.hidden = false;
    el.querySelector('[data-rating="up"]')?.addEventListener('click', () => onUp(action));
    el.querySelector('[data-rating="down"]')?.addEventListener('click', () => onDown(action));
  }

  function renderThanks(el) {
    el.innerHTML = '<p class="cutup-pipeline-feedback__thanks">Thanks for your feedback!</p>';
    el.hidden = false;
  }

  function renderComment(el, action) {
    el.innerHTML = `
      <div class="cutup-pipeline-feedback__comment">
        <textarea class="cutup-pipeline-feedback__textarea" rows="2" maxlength="500" placeholder="What could we improve? (optional)"></textarea>
        <div class="cutup-pipeline-feedback__comment-actions">
          <button type="button" class="cutup-pipeline-feedback__text-btn" data-cancel>Cancel</button>
          <button type="button" class="cutup-pipeline-feedback__text-btn cutup-pipeline-feedback__text-btn--submit" data-submit>Submit</button>
        </div>
      </div>
    `;
    el.hidden = false;
    const textarea = el.querySelector('textarea');
    el.querySelector('[data-cancel]')?.addEventListener('click', () => {
      submitFeedback(action, 'down', '', pending?.meta || {});
      dismiss();
    });
    el.querySelector('[data-submit]')?.addEventListener('click', () => {
      const comment = String(textarea?.value || '').trim();
      submitFeedback(action, 'down', comment, pending?.meta || {});
      dismiss();
    });
    textarea?.focus();
  }

  function dismiss() {
    const el = ensureRoot();
    fadeOut(el, () => {
      el.innerHTML = '';
      pending = null;
    });
  }

  function submitFeedback(action, rating, comment, meta) {
    const sessionId = getSessionId();
    const payload = {
      action,
      rating,
      comment: comment || undefined,
      metadata: meta || {}
    };
    global.fetch('/api/pipeline-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Session-Id': sessionId } : {})
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  function onUp(action) {
    if (!pending) return;
    markShown(action, pending.contextKey);
    submitFeedback(action, 'up', '', pending.meta);
    const el = ensureRoot();
    fadeOut(el, () => {
      renderThanks(el);
      global.setTimeout(() => dismiss(), THANKS_MS);
    });
  }

  function onDown(action) {
    if (!pending) return;
    const ctx = pending;
    markShown(action, ctx.contextKey);
    const el = ensureRoot();
    fadeOut(el, () => renderComment(el, action));
  }

  function show(action, meta = {}) {
    const contextKey =
      meta.contextKey ||
      meta.jobId ||
      (meta.kind && meta.targetLanguage ? `${meta.kind}_${meta.targetLanguage}` : null) ||
      String(Date.now());

    if (wasShown(action, contextKey)) return;

    if (pending?.timer) global.clearTimeout(pending.timer);
    pending = {
      action,
      contextKey,
      meta: { ...meta, contextKey },
      timer: global.setTimeout(() => {
        if (wasShown(action, contextKey)) return;
        const el = ensureRoot();
        renderPrompt(el, action);
      }, SHOW_DELAY_MS)
    };
  }

  function cancelPending() {
    if (pending?.timer) global.clearTimeout(pending.timer);
    pending = null;
  }

  global.CutupPipelineFeedback = {
    show,
    cancelPending,
    dismiss
  };
})(window);
