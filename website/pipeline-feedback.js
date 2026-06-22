/**
 * Minimal post-job feedback (transcription / translation / export).
 */
(function (global) {
  'use strict';

  const FADE_MS = 280;
  const THANKS_MS = 1600;
  const SHOW_DELAY_MS = 1400;

  let root = null;
  let pendingTimer = null;
  /** Active prompt session — survives after the show timer fires. */
  let active = null;

  function getSessionId() {
    if (typeof global.getCutupSessionId === 'function') return global.getCutupSessionId();
    return global.localStorage?.getItem('cutup_session') || null;
  }

  function feedbackApiUrl() {
    const base =
      typeof global.API_BASE_URL === 'string' && global.API_BASE_URL
        ? global.API_BASE_URL.replace(/\/$/, '')
        : '';
    return `${base}/api/pipeline-feedback`;
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
    if (root && document.body.contains(root)) {
      bindRootEvents(root);
      return root;
    }
    root = document.createElement('div');
    root.id = 'cutupPipelineFeedback';
    root.className = 'cutup-pipeline-feedback';
    root.hidden = true;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
    bindRootEvents(root);
    return root;
  }

  function bindRootEvents(el) {
    if (!el || el.dataset.cutupPfBound === '1') return;
    el.dataset.cutupPfBound = '1';
    el.addEventListener('click', (event) => {
      const ratingBtn = event.target.closest('[data-rating]');
      if (ratingBtn) {
        event.preventDefault();
        event.stopPropagation();
        const rating = ratingBtn.getAttribute('data-rating');
        if (rating === 'up') onUp();
        else if (rating === 'down') onDown();
        return;
      }
      if (event.target.closest('[data-cancel]')) {
        event.preventDefault();
        onDownSubmit('');
        return;
      }
      if (event.target.closest('[data-submit]')) {
        event.preventDefault();
        const textarea = el.querySelector('.cutup-pipeline-feedback__textarea');
        onDownSubmit(String(textarea?.value || '').trim());
      }
    });
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

  function renderPrompt(el) {
    if (!active) return;
    el.classList.remove('is-fading');
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
  }

  function renderThanks(el) {
    el.classList.remove('is-fading');
    el.innerHTML = '<p class="cutup-pipeline-feedback__thanks">Thanks for your feedback!</p>';
    el.hidden = false;
  }

  function renderComment(el) {
    el.classList.remove('is-fading');
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
    el.querySelector('textarea')?.focus();
  }

  function dismiss() {
    clearPendingTimer();
    active = null;
    const el = root;
    if (!el) return;
    fadeOut(el, () => {
      el.innerHTML = '';
    });
  }

  function clearPendingTimer() {
    if (pendingTimer) global.clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function submitFeedback(action, rating, comment, meta) {
    const sessionId = getSessionId();
    const payload = {
      action,
      rating,
      comment: comment || undefined,
      metadata: meta || {}
    };
    global
      .fetch(feedbackApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'X-Session-Id': sessionId } : {})
        },
        body: JSON.stringify(payload)
      })
      .catch((err) => {
        console.warn('[pipeline-feedback] submit failed', err?.message || err);
      });
  }

  function onUp() {
    if (!active) return;
    const { action, contextKey, meta } = active;
    markShown(action, contextKey);
    submitFeedback(action, 'up', '', meta);
    const el = ensureRoot();
    fadeOut(el, () => {
      renderThanks(el);
      global.setTimeout(() => dismiss(), THANKS_MS);
    });
  }

  function onDown() {
    if (!active) return;
    const { action, contextKey } = active;
    markShown(action, contextKey);
    const el = ensureRoot();
    fadeOut(el, () => renderComment(el));
  }

  function onDownSubmit(comment) {
    if (!active) return;
    const { action, meta } = active;
    submitFeedback(action, 'down', comment, meta);
    dismiss();
  }

  function show(action, meta = {}) {
    const contextKey =
      meta.contextKey ||
      meta.jobId ||
      (meta.kind && meta.targetLanguage ? `${meta.kind}_${meta.targetLanguage}` : null) ||
      String(Date.now());

    if (wasShown(action, contextKey)) return;

    clearPendingTimer();

    const el = ensureRoot();
    el.innerHTML = '';
    el.hidden = true;
    el.classList.remove('is-fading');

    active = {
      action,
      contextKey,
      meta: { ...meta, contextKey }
    };

    pendingTimer = global.setTimeout(() => {
      pendingTimer = null;
      if (!active || active.contextKey !== contextKey) return;
      if (wasShown(action, contextKey)) {
        active = null;
        return;
      }
      const el = ensureRoot();
      renderPrompt(el);
    }, SHOW_DELAY_MS);
  }

  function cancelPending() {
    clearPendingTimer();
  }

  global.CutupPipelineFeedback = {
    show,
    cancelPending,
    dismiss
  };
})(window);
