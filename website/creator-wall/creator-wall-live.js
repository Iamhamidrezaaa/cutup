/**
 * Live metrics (hybrid base + micro-increments) + activity ticker.
 * Phase 2: resync base from DB aggregates via /api/creator-wall?action=stats
 */
(function (global) {
  'use strict';

  const METRIC_KEYS = [
    { key: 'videos', attr: 'data-cw-stat-videos', label: 'EXPORTS GENERATED', rate: 'exportsPerSec' },
    { key: 'subs', attr: 'data-cw-stat-subs', label: 'SUBTITLE LINES', rate: 'subtitlesPerSec' },
    { key: 'creators', attr: 'data-cw-stat-creators', label: 'CREATORS', rate: 'creatorsPerSec' },
    { key: 'highlights', attr: 'data-cw-stat-highlights', label: 'AI HIGHLIGHTS', rate: 'highlightsPerSec' }
  ];

  const state = {
    display: {},
    target: {},
    rates: {},
    raf: null,
    tickTimer: null,
    resyncTimer: null,
    lastTs: 0
  };

  function formatFull(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function mapStatsFromApi(stats) {
    return {
      videos: stats.videosThisWeek,
      subs: stats.subtitlesGenerated,
      creators: stats.creatorsOnboarded,
      highlights: stats.exportMinutesRendered
    };
  }

  function mapRates(stats) {
    const r = stats.incrementRates || {};
    return {
      videos: r.exportsPerSec ?? 0.35,
      subs: r.subtitlesPerSec ?? 2.2,
      creators: r.creatorsPerSec ?? 0.05,
      highlights: r.highlightsPerSec ?? 0.85
    };
  }

  function renderMetrics(pulse) {
    METRIC_KEYS.forEach(({ key, attr }) => {
      const valEl = document.querySelector(`[${attr}]`);
      if (!valEl) return;
      valEl.textContent = formatFull(state.display[key]);
      const tile = valEl.closest('.creator-wall__metric-tile');
      if (pulse && tile) {
        tile.classList.remove('creator-wall__metric-tile--pulse');
        void tile.offsetWidth;
        tile.classList.add('creator-wall__metric-tile--pulse');
      }
    });
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min(4, (now - state.lastTs) / 1000);
    state.lastTs = now;

    METRIC_KEYS.forEach(({ key }) => {
      const rate = state.rates[key] || 0;
      const jitter = 0.65 + Math.random() * 0.7;
      state.display[key] += rate * dt * jitter;
      if (state.display[key] > state.target[key] + rate * 12) {
        state.target[key] = state.display[key];
      }
    });

    renderMetrics(false);
    state.raf = requestAnimationFrame(tick);
  }

  function initMetrics(stats) {
    const mapped = mapStatsFromApi(stats);
    state.rates = mapRates(stats);
    METRIC_KEYS.forEach(({ key }) => {
      state.display[key] = mapped[key];
      state.target[key] = mapped[key];
    });
    state.lastTs = performance.now();
    renderMetrics(true);

    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }

  async function resyncMetrics() {
    try {
      const r = await fetch('/api/creator-wall?action=stats');
      const data = await r.json();
      if (!data.ok || !data.stats) return;
      const mapped = mapStatsFromApi(data.stats);
      METRIC_KEYS.forEach(({ key }) => {
        if (mapped[key] > state.display[key]) {
          state.display[key] = mapped[key];
          state.target[key] = mapped[key];
        }
      });
      state.rates = mapRates(data.stats);
    } catch {
      /* noop */
    }
  }

  /* Activity ticker */
  let tickerIdx = 0;
  let tickerEvents = [];
  let tickerTimer = null;

  function setTickerMessage(msg) {
    const a = document.getElementById('creatorWallTickerA');
    const b = document.getElementById('creatorWallTickerB');
    if (!a || !b) return;
    const inactive = a.classList.contains('creator-wall__ticker-line--active') ? b : a;
    const active = inactive === a ? b : a;
    inactive.textContent = msg;
    inactive.classList.add('creator-wall__ticker-line--active');
    active.classList.remove('creator-wall__ticker-line--active');
  }

  function rotateTicker() {
    if (!tickerEvents.length) return;
    tickerIdx = (tickerIdx + 1) % tickerEvents.length;
    setTickerMessage(`+ ${tickerEvents[tickerIdx].message}`);
  }

  async function initTicker() {
    try {
      const r = await fetch('/api/creator-wall?action=activity');
      const data = await r.json();
      if (data.ok && Array.isArray(data.events)) tickerEvents = data.events;
    } catch {
      tickerEvents = [
        { message: 'New TikTok subtitles generated · Germany' },
        { message: 'Podcast transcript exported · Canada' },
        { message: 'Hormozi style render completed · USA' }
      ];
    }
    if (tickerEvents.length) setTickerMessage(`+ ${tickerEvents[0].message}`);
    if (tickerTimer) clearInterval(tickerTimer);
    tickerTimer = setInterval(rotateTicker, 4800);
  }

  let layerStarted = false;

  function startLiveLayer(stats) {
    if (!layerStarted) {
      initMetrics(stats);
      initTicker();
      layerStarted = true;
    }
    if (state.resyncTimer) clearInterval(state.resyncTimer);
    state.resyncTimer = setInterval(resyncMetrics, 60000);
  }

  function stopLiveLayer() {
    if (state.raf) cancelAnimationFrame(state.raf);
    if (tickerTimer) clearInterval(tickerTimer);
    if (state.resyncTimer) clearInterval(state.resyncTimer);
    state.raf = null;
    tickerTimer = null;
    state.resyncTimer = null;
    layerStarted = false;
  }

  global.CutupCreatorWallLive = { startLiveLayer, stopLiveLayer, resyncMetrics };
})(typeof window !== 'undefined' ? window : globalThis);
