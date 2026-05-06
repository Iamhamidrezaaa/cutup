/** Chart.js — Audit Log analytics (prominent blocks) */
window.CutupAuditLogCharts = (function () {
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

  const chartOpts = (grid) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: grid }, ticks: { font: { size: 11 } } },
      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0 } }
    }
  });

  function render(charts) {
    if (!charts || typeof Chart === 'undefined') return;
    const grid = cssVar('--border', '#e2e8f0');
    const primary = cssVar('--primary', '#6366f1');
    const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

    const events = charts.events || [];
    setChart('axlChartEvents', {
      type: 'line',
      data: {
        labels: events.map((x) => String(x.t || '').slice(5, 16)),
        datasets: [
          {
            label: 'Events',
            data: events.map((x) => x.count),
            borderColor: primary,
            backgroundColor: 'rgba(99, 102, 241, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2
          }
        ]
      },
      options: chartOpts(grid)
    });

    const cats = charts.byCategory || [];
    setChart('axlChartCategory', {
      type: 'doughnut',
      data: {
        labels: cats.map((x) => x.label),
        datasets: [{ data: cats.map((x) => x.count), backgroundColor: palette }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } }
      }
    });

    const countries = charts.byCountry || [];
    setChart('axlChartCountries', {
      type: 'bar',
      data: {
        labels: countries.map((x) => x.label),
        datasets: [{ data: countries.map((x) => x.count), backgroundColor: '#0ea5e9' }]
      },
      options: { ...chartOpts(grid), indexAxis: 'y' }
    });

    const actions = charts.byEventName || [];
    setChart('axlChartActions', {
      type: 'bar',
      data: {
        labels: actions.map((x) => String(x.label).slice(0, 24)),
        datasets: [{ data: actions.map((x) => x.count), backgroundColor: primary }]
      },
      options: chartOpts(grid)
    });
  }

  return { render, destroyAll };
})();
