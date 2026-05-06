/**
 * Simulated subtitle preview — CSS + lightweight timers only.
 */
(function (global) {
  'use strict';

  class FakePlayerAnimator {
    /**
     * @param {HTMLElement} root
     * @param {{ start: number, end: number, text: string }[]} lines
     * @param {number} totalDurationSec
     */
    constructor(root, lines, totalDurationSec) {
      this.root = root;
      this.lines = Array.isArray(lines) ? lines.filter((l) => l && l.text) : [];
      this.totalDurationSec = Math.max(12, Number(totalDurationSec) || 60);
      this.index = 0;
      this.timers = [];
      this.running = false;
      this.captionEl = root.querySelector('[data-fake-caption]');
      this.highlightEl = root.querySelector('[data-fake-highlight]');
      this.timeEl = root.querySelector('[data-fake-time]');
      this.progressEl = root.querySelector('[data-fake-progress]');
      this._cycleMs = 3800;
    }

    start() {
      if (!this.lines.length || !this.captionEl) return;
      this.stop();
      this.running = true;
      this._showLine(0);
      const tick = () => {
        if (!this.running) return;
        this.index = (this.index + 1) % this.lines.length;
        this._showLine(this.index);
      };
      this.timers.push(setInterval(tick, this._cycleMs));
      if (this.progressEl) {
        this.progressEl.style.animation = 'none';
        void this.progressEl.offsetWidth;
        const loopSec = Math.min(48, Math.max(14, this.lines.length * 3.2));
        this.progressEl.style.animation = `cutupFakeProgress ${loopSec}s linear infinite`;
      }
    }

    _showLine(i) {
      const line = this.lines[i];
      if (!line || !this.captionEl) return;
      const text = String(line.text);
      const words = text.split(/\s+/).filter(Boolean);
      const mid = Math.max(1, Math.floor(words.length / 2));
      const plain = words.join(' ');
      const hi = words.slice(mid).join(' ');
      const lo = words.slice(0, mid).join(' ');

      this.captionEl.classList.remove('cutup-fake-caption--in');
      void this.captionEl.offsetWidth;
      if (this.highlightEl && words.length > 2) {
        this.captionEl.innerHTML = `${escapeHtml(lo)} <span class="cutup-fake-caption-hi" data-fake-highlight>${escapeHtml(hi)}</span>`;
      } else {
        this.captionEl.textContent = plain;
      }
      this.captionEl.classList.add('cutup-fake-caption--in');

      if (this.timeEl) {
        this.timeEl.textContent = formatClock(line.start);
      }
    }

    pause() {
      this.running = false;
      this.timers.forEach(clearInterval);
      this.timers = [];
      if (this.progressEl) this.progressEl.style.animationPlayState = 'paused';
    }

    resume() {
      if (!this.lines.length) return;
      if (!this.running) {
        this.start();
        return;
      }
      if (this.progressEl) this.progressEl.style.animationPlayState = 'running';
    }

    stop() {
      this.pause();
      this.index = 0;
      if (this.progressEl) {
        this.progressEl.style.animation = 'none';
      }
    }

    destroy() {
      this.stop();
      this.root = null;
      this.captionEl = null;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatClock(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  global.CutupFakePlayerAnimator = FakePlayerAnimator;
})(typeof window !== 'undefined' ? window : globalThis);
