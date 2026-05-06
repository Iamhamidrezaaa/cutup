/** Chart.js bindings for admin Saved Outputs workspace */
window.CutupOutputsCharts = (function () {
  const instances = new Map();

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function destroyAll() {
    instances.forEach((c) => {
      try {
        c.destroy();
      } catch (_e) {
        /* noop */
      }
    });
    instances.clear();
  }

  function setChart(id, config) {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const prev = instances.get(id);
    if (prev) {
      try {
        prev.destroy();
      } catch (_e) {
        /* noop */
      }
    }
    instances.set(id, new Chart(canvas.getContext('2d'), config));
  }

  function renderAll(analytics) {
    if (!analytics || typeof Chart === 'undefined') return;
    const grid = cssVar('--border', '#e2e8f0');
    const primary = cssVar('--primary', '#5b4ce6');
    const timeline = analytics.timeline || [];

    setChart('outputsChartTimeline', {
      type: 'bar',
      data: {
        labels: timeline.map((x) => x.day),
        datasets: [
          { label: 'Transcript', data: timeline.map((x) => x.transcript), backgroundColor: primary, stack: 'a' },
          { label: 'Summary', data: timeline.map((x) => x.summary), backgroundColor: '#0d9488', stack: 'a' },
          { label: 'SRT', data: timeline.map((x) => x.srt), backgroundColor: '#4338ca', stack: 'a' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: grid } }
        }
      }
    });

    const types = analytics.breakdowns?.byType || {};
    setChart('outputsChartType', {
      type: 'doughnut',
      data: {
        labels: ['Transcript', 'Summary', 'SRT', 'Other'],
        datasets: [
          {
            data: [
              types.transcript || 0,
              types.summary || 0,
              types.srt || 0,
              Object.entries(types).reduce((s, [k, v]) => {
                if (['transcript', 'summary', 'srt'].includes(k)) return s;
                return s + Number(v || 0);
              }, 0)
            ],
            backgroundColor: [primary, '#0d9488', '#4338ca', '#94a3b8']
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }
      }
    });

    const platforms = analytics.breakdowns?.byPlatform || [];
    setChart('outputsChartPlatform', {
      type: 'bar',
      data: {
        labels: platforms.map((p) => p.name),
        datasets: [{ label: 'Outputs', data: platforms.map((p) => p.count), backgroundColor: primary, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: grid } }, y: { grid: { display: false } } }
      }
    });

    const langs = analytics.breakdowns?.byLanguage || [];
    setChart('outputsChartLanguage', {
      type: 'bar',
      data: {
        labels: langs.map((l) => l.name),
        datasets: [{ label: 'Outputs', data: langs.map((l) => l.count), backgroundColor: '#a21caf', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: grid } }, y: { grid: { display: false } } }
      }
    });

    const fav = analytics.breakdowns?.favoriteTrend || [];
    setChart('outputsChartFavorites', {
      type: 'line',
      data: {
        labels: fav.map((x) => x.day),
        datasets: [
          {
            label: 'Favorites saved',
            data: fav.map((x) => x.favorites),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: { color: grid } }, x: { grid: { display: false } } }
      }
    });
  }

  return { renderAll, destroyAll };
})();
