/** Chart.js bindings for admin Payments workspace */
window.CutupPayCharts = (function () {
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

    setChart('payChartRevenue', {
      type: 'line',
      data: {
        labels: timeline.map((x) => x.bucket),
        datasets: [
          {
            label: 'Revenue EUR',
            data: timeline.map((x) => x.revenue),
            borderColor: primary,
            backgroundColor: 'rgba(91, 76, 230, 0.12)',
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

    const funnel = analytics.funnel || {};
    setChart('payChartFunnel', {
      type: 'bar',
      data: {
        labels: ['Pricing', 'Checkout', 'Initiated', 'Success', 'Activated'],
        datasets: [
          {
            label: 'Count',
            data: [
              funnel.pricingViewed || 0,
              funnel.checkoutStarted || 0,
              funnel.paymentInitiated || 0,
              funnel.callbackSuccess || 0,
              funnel.subscriptionActivated || 0
            ],
            backgroundColor: [primary, '#0d9488', '#4338ca', '#22c55e', '#f59e0b'],
            borderRadius: 6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: grid } }, y: { grid: { display: false } } }
      }
    });

    const providers = analytics.breakdowns?.byProvider || [];
    setChart('payChartGateway', {
      type: 'bar',
      data: {
        labels: providers.map((p) => p.name),
        datasets: [
          { label: 'Success', data: providers.map((p) => p.success), backgroundColor: '#22c55e', stack: 'a' },
          { label: 'Failed', data: providers.map((p) => p.failed), backgroundColor: '#ef4444', stack: 'a' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: grid } } }
      }
    });

    const plans = analytics.breakdowns?.byPlan || {};
    setChart('payChartPlans', {
      type: 'doughnut',
      data: {
        labels: Object.keys(plans),
        datasets: [
          {
            data: Object.values(plans).map((p) => p.revenue || 0),
            backgroundColor: [primary, '#0d9488', '#f59e0b', '#94a3b8']
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  return { renderAll, destroyAll };
})();
