/** Chart.js bindings for admin Usage workspace */
window.CutupUsageCharts = (function () {
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

    const labels = timeline.map((x) => x.day);
    setChart('usageChartTimeline', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Transcript', data: timeline.map((x) => x.transcript), backgroundColor: primary, stack: 'a' },
          { label: 'Translate', data: timeline.map((x) => x.translate), backgroundColor: '#a21caf', stack: 'a' },
          { label: 'Summary', data: timeline.map((x) => x.summary), backgroundColor: '#0d9488', stack: 'a' },
          { label: 'SRT', data: timeline.map((x) => x.srt), backgroundColor: '#4338ca', stack: 'a' },
          { label: 'Audio DL', data: timeline.map((x) => x.downloadAudio), backgroundColor: '#f59e0b', stack: 'a' },
          { label: 'Video DL', data: timeline.map((x) => x.downloadVideo), backgroundColor: '#3b82f6', stack: 'a' }
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

    const feat = analytics.breakdowns?.byFeature || {};
    setChart('usageChartFeature', {
      type: 'doughnut',
      data: {
        labels: ['Transcript', 'Translate', 'Summary', 'Audio', 'Video', 'SRT'],
        datasets: [
          {
            data: [
              feat.transcript || 0,
              feat.translate || 0,
              feat.summary || 0,
              feat.downloadAudio || 0,
              feat.downloadVideo || 0,
              feat.srt || 0
            ],
            backgroundColor: [primary, '#a21caf', '#0d9488', '#f59e0b', '#3b82f6', '#4338ca']
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
    setChart('usageChartPlatform', {
      type: 'bar',
      data: {
        labels: platforms.map((p) => p.name),
        datasets: [{ label: 'Events', data: platforms.map((p) => p.count), backgroundColor: primary, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: grid } }, y: { grid: { display: false } } }
      }
    });
  }

  return { renderAll, destroyAll };
})();
