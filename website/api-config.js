(function () {
  if (typeof window === 'undefined') return;
  var o = window.location && window.location.origin ? window.location.origin : '';
  window.CUTUP_API_BASE = o.indexOf('localhost') !== -1 ? 'http://localhost:3001' : '';
})();
