/**
 * Cinematic AI preview card — mounts after successful transcription.
 */
(function (global) {
  'use strict';

  const PLATFORM_META = {
    youtube: { label: 'YouTube', icon: '▶', placeholder: '▶', theme: 'youtube' },
    tiktok: { label: 'TikTok', icon: '♪', placeholder: '♪', theme: 'tiktok' },
    instagram: { label: 'Instagram', icon: '◎', placeholder: '◎', theme: 'instagram' },
    upload: { label: 'Upload', icon: '↑', placeholder: '📁', theme: 'upload' },
    audiofile: { label: 'Upload', icon: '↑', placeholder: '📁', theme: 'upload' }
  };

  let activeAnimator = null;
  let activeObserver = null;
  let activeMount = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveThumbnail(meta) {
    if (meta.thumbnailUrl) return meta.thumbnailUrl;
    if (meta.videoId) return `https://i.ytimg.com/vi/${encodeURIComponent(meta.videoId)}/hqdefault.jpg`;
    return '';
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function languageLabel(code) {
    const c = String(code || '').toLowerCase().slice(0, 8);
    const map = {
      en: 'English',
      fa: 'Persian',
      ar: 'Arabic',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      auto: 'Auto-detected'
    };
    return map[c] || (c ? c.toUpperCase() : 'Auto-detected');
  }

  /** Count-up stats (lightweight rAF; respects reduced motion). */
  function animateCounters(root) {
    const els = root.querySelectorAll('[data-count-to]');
    if (!els.length) return;
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => {
        el.textContent = el.getAttribute('data-count-to');
      });
      return;
    }
    els.forEach((el) => {
      const target = Number(el.getAttribute('data-count-to')) || 0;
      const start = performance.now();
      const dur = 720;
      function frame(now) {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - (1 - t) ** 3;
        el.textContent = String(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  function buildStatsStrip(stats, viralCount) {
    const words = Number(stats.wordCount) || 0;
    const cues = Number(stats.segmentCount) || 0;
    const viral = Number(viralCount) || 0;
    return `
      <div class="cutup-cine-stats cutup-cine-stagger" style="--stagger:2" aria-label="Transcript analysis stats">
        <div class="cutup-cine-stat cutup-cine-stat--pulse">
          <span class="cutup-cine-stat__val" data-count-to="${cues}">0</span>
          <span class="cutup-cine-stat__lbl">Subtitle cues</span>
        </div>
        <div class="cutup-cine-stat cutup-cine-stat--pulse">
          <span class="cutup-cine-stat__val" data-count-to="${words}">0</span>
          <span class="cutup-cine-stat__lbl">Words scanned</span>
        </div>
        <div class="cutup-cine-stat cutup-cine-stat--pulse">
          <span class="cutup-cine-stat__val" data-count-to="${viral}">0</span>
          <span class="cutup-cine-stat__lbl">Viral moments</span>
        </div>
      </div>`;
  }

  function buildWaveformBars() {
    return '<div class="cutup-cine-waveform" aria-hidden="true">' + '<span></span>'.repeat(12) + '</div>';
  }

  function buildTopBar(meta) {
    const platform = String(meta.platform || 'upload').toLowerCase();
    const p = PLATFORM_META[platform] || {
      label: platform.charAt(0).toUpperCase() + platform.slice(1),
      icon: '•',
      placeholder: '🎬',
      theme: 'upload'
    };
    const thumb = resolveThumbnail(meta);
    const title = escapeHtml(meta.title || 'Your video');
    const durSec = Number(meta.durationSec) || 0;
    const durLabel = durSec > 0 ? formatDuration(durSec) : 'Timed';
    const lang = escapeHtml(languageLabel(meta.language));

    const thumbInner = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">`
      : `<div class="cutup-cine-hero__thumb--placeholder cutup-cine-hero__thumb--${escapeHtml(p.theme)}" aria-hidden="true"><span>${p.placeholder}</span></div>`;

    return `
      <header class="cutup-cine-topbar cutup-cine-stagger" style="--stagger:0">
        <div class="cutup-cine-topbar__lead">
          <p class="cutup-cine-eyebrow">
            <span class="cutup-cine-live"><span class="cutup-cine-live__dot" aria-hidden="true"></span> Intelligence ready</span>
          </p>
          <h3 class="cutup-cine-hero__title">${title}</h3>
        </div>
        <div class="cutup-cine-topbar__meta">
          <div class="cutup-cine-thumb-mini">${thumbInner}</div>
          <span class="cutup-cine-badge cutup-cine-badge--platform">${p.icon} ${escapeHtml(p.label)}</span>
          <span class="cutup-cine-chip">⏱ ${escapeHtml(durLabel)}</span>
          <span class="cutup-cine-chip">🌐 ${lang}</span>
          <span class="cutup-cine-chip cutup-cine-chip--ai">✦ Analyzed</span>
        </div>
      </header>`;
  }

  function buildPayoffStrip(insights) {
    const picks = (insights || []).slice(0, 3);
    if (!picks.length) return '';
    const pills = picks
      .map(
        (ins) =>
          `<span class="cutup-cine-payoff__pill cutup-cine-stagger" style="--stagger:3" title="${escapeHtml(ins.detail)}"><span aria-hidden="true">${ins.icon}</span>${escapeHtml(ins.title)}</span>`
      )
      .join('');
    return `<div class="cutup-cine-payoff" aria-label="Key findings">${pills}</div>`;
  }

  function buildHeroPlayer(analysis, meta, insights) {
    const dur = meta.durationSec || analysis.stats.durationSec || 60;
    return `
      <section class="cutup-cine-hero-stage cutup-cine-stagger" style="--stagger:1" aria-label="Cinematic subtitle preview">
        <div class="cutup-cine-player">
          <div class="cutup-cine-player__frame">
            <div class="cutup-cine-player__scan" aria-hidden="true"></div>
            <div class="cutup-cine-player__glow-ring" aria-hidden="true"></div>
            <div class="cutup-cine-player__top">
              <span class="cutup-cine-player__label">Subtitle preview</span>
              <span class="cutup-cine-player__time" data-fake-time>00:00</span>
            </div>
            ${buildWaveformBars()}
            <p class="cutup-cine-player__caption" data-fake-caption>Scanning transcript…</p>
            <div class="cutup-cine-player__timeline">
              <div class="cutup-cine-player__track">
                <div class="cutup-cine-player__progress" data-fake-progress></div>
              </div>
              <div class="cutup-cine-player__ticks">
                <span>0:00</span><span>${escapeHtml(formatDuration(dur))}</span>
              </div>
            </div>
          </div>
        </div>
        ${buildPayoffStrip(insights)}
      </section>`;
  }

  function buildInsights(insights) {
    const cards = insights
      .map(
        (ins, i) => `
        <article class="cutup-cine-insight cutup-cine-stagger" style="--stagger:${2 + i}" data-insight-id="${escapeHtml(ins.id)}">
          <span class="cutup-cine-insight__icon" aria-hidden="true">${ins.icon}</span>
          <div>
            <h4 class="cutup-cine-insight__title">${escapeHtml(ins.title)}</h4>
            <p class="cutup-cine-insight__detail">${escapeHtml(ins.detail)}</p>
          </div>
        </article>`
      )
      .join('');
    return `<section class="cutup-cine-insights"><h3 class="cutup-cine-section-title cutup-cine-stagger" style="--stagger:4">Creator insights</h3><div class="cutup-cine-insights__grid">${cards}</div></section>`;
  }

  function buildViralMoments(moments, formatClock) {
    if (!moments.length) return '';
    const cards = moments
      .map(
        (m, i) => `
        <article class="cutup-cine-viral cutup-cine-stagger" style="--stagger:${6 + i}">
          <div class="cutup-cine-viral__head">
            <time class="cutup-cine-viral__time">${escapeHtml(formatClock(m.start))}</time>
            <span class="cutup-cine-viral__tag">${escapeHtml(m.reason)}</span>
          </div>
          <p class="cutup-cine-viral__text">${escapeHtml(m.text)}</p>
          <button type="button" class="cutup-cine-viral__copy" data-copy-viral="${i}" title="Copy quote">Copy</button>
        </article>`
      )
      .join('');
    return `<section class="cutup-cine-viral-section"><h3 class="cutup-cine-section-title cutup-cine-stagger" style="--stagger:6">Viral moments</h3><div class="cutup-cine-viral__grid">${cards}</div></section>`;
  }

  function buildChapters(chapters, formatClock) {
    if (!chapters.length) return '';
    const items = chapters
      .map(
        (ch, i) => `
        <button type="button" class="cutup-cine-chapter cutup-cine-stagger" style="--stagger:${9 + i}" data-chapter-jump="${ch.start}">
          <span class="cutup-cine-chapter__time">${escapeHtml(formatClock(ch.start))}</span>
          <span class="cutup-cine-chapter__label">${escapeHtml(ch.label)}</span>
        </button>`
      )
      .join('');
    return `<section class="cutup-cine-chapters"><h3 class="cutup-cine-section-title cutup-cine-stagger" style="--stagger:9">Smart chapters</h3><div class="cutup-cine-chapters__list">${items}</div></section>`;
  }

  function buildBodyGrid(insightsHtml, viralHtml, chaptersHtml) {
    const side = `${viralHtml || ''}${chaptersHtml || ''}`;
    if (!insightsHtml && !side) return '';
    const wrap = (cls, inner) =>
      `<div class="cutup-cine-body cutup-cine-stagger ${cls}" style="--stagger:4">${inner}</div>`;
    if (!insightsHtml) {
      return wrap('cutup-cine-body--single', `<div class="cutup-cine-side">${side}</div>`);
    }
    if (!side) {
      return wrap('cutup-cine-body--single', insightsHtml);
    }
    return wrap('', `${insightsHtml}<div class="cutup-cine-side">${side}</div>`);
  }

  function destroyActive() {
    if (activeAnimator) {
      activeAnimator.destroy();
      activeAnimator = null;
    }
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    activeMount = null;
  }

  function mount(container, payload) {
    destroyActive();
    if (!container) return;

    const Insights = global.CutupTranscriptInsights;
    const Animator = global.CutupFakePlayerAnimator;
    if (!Insights || !Animator) {
      console.warn('[cinematic-preview] modules not loaded');
      return;
    }

    const meta = payload.meta || {};
    const analysis = Insights.analyzeTranscript({
      segments: payload.segments,
      fullText: payload.fullText,
      durationSec: meta.durationSec,
      language: meta.language,
      platform: meta.platform
    });

    const formatClock = Insights.formatClock;
    const viralForCopy = analysis.viralMoments;

    container.hidden = false;
    container.classList.add('cutup-cinematic-mount--visible');
    const insightsHtml = buildInsights(analysis.insights);
    const viralHtml = buildViralMoments(analysis.viralMoments, formatClock);
    const chaptersHtml = buildChapters(analysis.chapters, formatClock);

    container.innerHTML = `
      <div class="cutup-cinematic-card" role="region" aria-label="AI cinematic preview">
        <div class="cutup-cine-ambient" aria-hidden="true">
          <span class="cutup-cine-ambient__orb cutup-cine-ambient__orb--1"></span>
          <span class="cutup-cine-ambient__orb cutup-cine-ambient__orb--2"></span>
        </div>
        <div class="cutup-cine-vignette" aria-hidden="true"></div>
        <div class="cutup-cine-shimmer" aria-hidden="true"></div>
        ${buildTopBar(meta)}
        ${buildHeroPlayer(analysis, meta, analysis.insights)}
        ${buildStatsStrip(analysis.stats, analysis.viralMoments.length)}
        ${buildBodyGrid(insightsHtml, viralHtml, chaptersHtml)}
        <footer class="cutup-cine-footer cutup-cine-stagger" style="--stagger:11">
          <p>Transcript, summary &amp; SRT are ready below.</p>
          <button type="button" class="cutup-cine-footer__cta" data-scroll-transcript>View transcript ↓</button>
        </footer>
      </div>`;

    const playerFrame = container.querySelector('.cutup-cine-player__frame');
    if (playerFrame) {
      activeAnimator = new Animator(
        playerFrame,
        analysis.playerLines,
        meta.durationSec || analysis.stats.durationSec
      );
      activeObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries.some((e) => e.isIntersecting);
          if (!activeAnimator) return;
          if (visible) activeAnimator.resume();
          else activeAnimator.pause();
        },
        { threshold: 0.12 }
      );
      activeObserver.observe(container);
      requestAnimationFrame(() => activeAnimator.start());
    }

    container.querySelectorAll('[data-copy-viral]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.getAttribute('data-copy-viral'));
        const text = viralForCopy[idx]?.text;
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied!';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1600);
        } catch {
          btn.textContent = 'Copy failed';
        }
      });
    });

    container.querySelectorAll('[data-chapter-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = document.querySelector('#resultSection .tab-btn[data-tab="fulltext"]');
        if (tab) tab.click();
        const full = document.getElementById('fulltext');
        if (full) full.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    const scrollBtn = container.querySelector('[data-scroll-transcript]');
    if (scrollBtn) {
      scrollBtn.addEventListener('click', () => {
        const tabs = document.querySelector('#resultSection .result-tabs');
        if (tabs) tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const resultSection = document.getElementById('resultSection');
    if (resultSection) resultSection.classList.add('cutup-has-cinematic-preview');

    requestAnimationFrame(() => animateCounters(container));

    activeMount = container;
    console.log('[cinematic-preview] mounted', {
      segments: analysis.stats.segmentCount,
      viral: analysis.viralMoments.length,
      chapters: analysis.chapters.length
    });
  }

  function unmount(container) {
    destroyActive();
    const resultSection = document.getElementById('resultSection');
    if (resultSection) resultSection.classList.remove('cutup-has-cinematic-preview');
    if (!container) return;
    container.hidden = true;
    container.classList.remove('cutup-cinematic-mount--visible');
    container.innerHTML = '';
  }

  global.CutupCinematicPreview = {
    mount,
    unmount,
    destroy: destroyActive
  };
})(typeof window !== 'undefined' ? window : globalThis);
