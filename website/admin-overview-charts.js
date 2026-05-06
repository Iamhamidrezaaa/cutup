/** Chart.js bindings for admin overview */
window.CutupDashCharts = (function () {
  const instances = new Map();

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
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
    const inst = new Chart(canvas.getContext('2d'), config);
    instances.set(id, inst);
  }

  function baseOptions() {
    const grid = cssVar('--border', '#e2e8f0');
  const primary = cssVar('--primary', '#5b4ce6');
    return { grid, primary };
  }

  function renderAll(d) {
    if (!d || typeof Chart === 'undefined') return;
    const { grid, primary } = baseOptions();
    const charts = d.charts || {};

    const revLabels = (d.revenue?.timeline || []).map((x) => x.day);
    const revData = (d.revenue?.timeline || []).map((x) => x.revenue);
    setChart('dashChartRevenue', {
      type: 'line',
      data: {
        labels: revLabels.length ? revLabels : ['No data'],
        datasets: [
          {
            label: 'Revenue (€)',
            data: revData.length ? revData : [0],
            borderColor: primary,
            backgroundColor: 'rgba(91, 76, 230, 0.08)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: grid }, ticks: { maxTicksLimit: 8 } },
          y: { beginAtZero: true, grid: { color: grid } }
        }
      }
    });

    const growth = charts.userGrowth || [];
    setChart('dashChartUserGrowth', {
      type: 'line',
      data: {
        labels: growth.map((x) => x.day),
        datasets: [
          {
            label: 'New users',
            data: growth.map((x) => x.users),
            borderColor: '#0d9488',
            backgroundColor: 'rgba(13, 148, 136, 0.12)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: grid } },
          y: { beginAtZero: true, grid: { color: grid } }
        }
      }
    });

    const feat = charts.featureUsage || {};
    setChart('dashChartFeatures', {
      type: 'bar',
      data: {
        labels: ['Transcript', 'Translate', 'Summary', 'Video DL', 'Audio DL'],
        datasets: [
          {
            label: 'Usage',
            data: [
              feat.transcript || 0,
              feat.translate || 0,
              feat.summary || 0,
              feat.downloadVideo || 0,
              feat.downloadAudio || 0
            ],
            backgroundColor: [
              primary,
              '#7c3aed',
              '#0d9488',
              '#f59e0b',
              '#3b82f6'
            ],
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: grid } }
        }
      }
    });

    const plans = charts.plansDistribution || [];
    setChart('dashChartPlans', {
      type: 'doughnut',
      data: {
        labels: plans.map((p) => window.CutupDashFmt.planLabel(p.plan)),
        datasets: [
          {
            data: plans.map((p) => p.count),
            backgroundColor: ['#94a3b8', primary, '#7c3aed', '#0d9488', '#f59e0b']
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });

    const countries = (d.users?.countries || []).slice(0, 8);
    setChart('dashChartCountries', {
      type: 'bar',
      data: {
        labels: countries.map((c) => c.country),
        datasets: [
          {
            label: 'Users',
            data: countries.map((c) => c.count),
            backgroundColor: primary,
            borderRadius: 4
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: grid } },
          y: { grid: { display: false } }
        }
      }
    });

    const cvr = charts.costVsRevenue || [];
    setChart('dashChartCostRevenue', {
      type: 'bar',
      data: {
        labels: cvr.map((x) => x.day),
        datasets: [
          {
            label: 'Revenue €',
            data: cvr.map((x) => x.revenue),
            backgroundColor: 'rgba(91, 76, 230, 0.7)',
            borderRadius: 4
          },
          {
            label: 'AI cost €',
            data: cvr.map((x) => x.costEur),
            backgroundColor: 'rgba(220, 38, 38, 0.55)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: false, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: grid } }
        }
      }
    });
  }

  return { renderAll, destroyAll };
})();
