/** Chart.js — AI Operations Center */
window.CutupAiStateCharts = (function () {
  const instances = new Map();

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function destroyAll() {
    instances.forEach((c) => {
      try {
        c.destroy();
      } catch (_e) {}
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
      } catch (_e) {}
    }
    instances.set(id, new Chart(canvas.getContext('2d'), config));
  }

  function renderAll(cost) {
    if (!cost || typeof Chart === 'undefined') return;
    const grid = cssVar('--border', '#e2e8f0');
    const primary = cssVar('--primary', '#6366f1');

    const timeline = cost.timeline || [];
    setChart('aiChartCostArea', {
      type: 'line',
      data: {
        labels: timeline.map((x) => x.day),
        datasets: [
          {
            label: 'Est. spend (EUR)',
            data: timeline.map((x) => x.costEur),
            borderColor: primary,
            backgroundColor: 'rgba(99, 102, 241, 0.12)',
            fill: true,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, grid: { color: grid } }, x: { grid: { display: false } } }
      }
    });

    const f = cost.byFeature || {};
    setChart('aiChartCostFeature', {
      type: 'bar',
      data: {
        labels: ['Transcript', 'Translate', 'Summary', 'Download', 'SRT'],
        datasets: [
          {
            label: 'Jobs',
            data: [f.transcript || 0, f.translate || 0, f.summary || 0, f.download || 0, f.srt || 0],
            backgroundColor: ['#6366f1', '#a21caf', '#0d9488', '#f59e0b', '#3b82f6']
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, grid: { color: grid } }, x: { grid: { display: false } } }
      }
    });

    const users = cost.topUsers || [];
    setChart('aiChartTopUsers', {
      type: 'bar',
      data: {
        labels: users.map((u) => String(u.email || '').split('@')[0]),
        datasets: [
          {
            label: 'EUR (est.)',
            data: users.map((u) => u.costEur),
            backgroundColor: primary
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { beginAtZero: true, grid: { color: grid } }, y: { grid: { display: false } } }
      }
    });
  }

  return { renderAll, destroyAll };
})();
