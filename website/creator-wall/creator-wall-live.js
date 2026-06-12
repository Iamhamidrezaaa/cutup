/**
 * Live metrics: server totals (slow simulated floor + real DB usage). Resyncs on a timer.
 */
(function (global) {
  'use strict';

  const METRIC_KEYS = [
    { key: 'videos', attr: 'data-cw-stat-videos' },
    { key: 'subs', attr: 'data-cw-stat-subs' },
    { key: 'creators', attr: 'data-cw-stat-creators' },
    { key: 'highlights', attr: 'data-cw-stat-highlights' }
  ];

  const state = {
    display: {},
    resyncTimer: null
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

  function applyServerStats(stats) {
    const mapped = mapStatsFromApi(stats);
    let changed = false;
    METRIC_KEYS.forEach(({ key }) => {
      const next = Number(mapped[key]) || 0;
      if (next !== state.display[key]) changed = true;
      state.display[key] = next;
    });
    renderMetrics(changed);
  }

  async function resyncMetrics() {
    try {
      const r = await fetch('/api/creator-wall?action=stats');
      const data = await r.json();
      if (!data.ok || !data.stats) return;
      applyServerStats(data.stats);
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
      applyServerStats(stats);
      initTicker();
      layerStarted = true;
    }
    if (state.resyncTimer) clearInterval(state.resyncTimer);
    state.resyncTimer = setInterval(resyncMetrics, 30000);
  }

  function stopLiveLayer() {
    if (tickerTimer) clearInterval(tickerTimer);
    if (state.resyncTimer) clearInterval(state.resyncTimer);
    tickerTimer = null;
    state.resyncTimer = null;
    layerStarted = false;
  }

  global.CutupCreatorWallLive = { startLiveLayer, stopLiveLayer, resyncMetrics };
})(typeof window !== 'undefined' ? window : globalThis);
