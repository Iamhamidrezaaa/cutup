/**
 * Runs before dashboard.js — fixes session-in-hash URLs and activates the target section early (no overview flash).
 */
(function () {
  'use strict';

  function repairSessionInHash() {
    var hash = window.location.hash || '';
    var match = hash.match(/^#([^?]+)\?session=([^&#]+)/);
    if (!match) return;
    var params = new URLSearchParams(window.location.search);
    if (!params.get('session')) params.set('session', match[2]);
    var qs = params.toString();
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + (qs ? '?' + qs : '') + '#' + match[1],
    );
  }

  function activateSectionFromHash() {
    var hash = (window.location.hash || '').replace(/^#/, '').split('?')[0].trim();
    if (!hash) return;
    var base = hash.split('/')[0];
    var section = document.getElementById(base + '-section');
    if (!section) return;
    document.querySelectorAll('.dashboard-section').forEach(function (el) {
      el.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.remove('active');
    });
    section.classList.add('active');
    var nav = document.querySelector('.nav-item[data-section="' + base + '"]');
    if (nav) nav.classList.add('active');
  }

  repairSessionInHash();
  activateSectionFromHash();
})();
