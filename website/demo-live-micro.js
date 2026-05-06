/**
 * Cutup Preview — looping micro-demo (processing → outputs → style).
 */
(function () {
  'use strict';

  const STEPS = [
    { id: 'processing', label: 'Processing audio…', panel: null },
    { id: 'subtitles', label: 'Generating subtitles…', panel: 'srt' },
    { id: 'transcript', label: 'Building transcript…', panel: 'transcript' },
    { id: 'summary', label: 'AI summary ready', panel: 'summary' },
    { id: 'highlights', label: 'Extracting highlights…', panel: 'summary' },
    { id: 'style', label: 'Hormozi style applied', panel: 'srt', style: 'hormozi' }
  ];

  let stepIdx = 0;
  let timer = null;

  function $(sel) {
    return document.querySelector(sel);
  }

  function applyStep(step) {
    const frame = $('.demo-product-frame');
    const badge = $('.demo-live-badge');
    const proc = $('.demo-processing');
    const panels = document.querySelectorAll('[data-demo-panel]');

    if (badge) badge.textContent = step.id === 'processing' ? 'Live AI output' : 'Cutup engine';
    if (proc) {
      const showProc = step.id === 'processing';
      proc.hidden = !showProc;
      if (showProc) {
        let tn = Array.from(proc.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
        if (!tn) {
          tn = document.createTextNode(step.label);
          proc.insertBefore(tn, proc.firstChild);
        } else {
          tn.nodeValue = step.label;
        }
      }
    }
    if (frame) {
      frame.classList.toggle('demo-product-frame--processing', step.id === 'processing');
      frame.classList.toggle('demo-product-frame--style-flash', step.id === 'style');
    }

    panels.forEach((p) => {
      const id = p.getAttribute('data-demo-panel');
      const on = step.panel === id;
      p.classList.toggle('demo-panel--active', on);
    });

    const pre = $('.demo-sample-pre');
    if (pre && step.id === 'style') {
      pre.classList.add('demo-srt--styled');
    } else if (pre) {
      pre.classList.remove('demo-srt--styled');
    }
  }

  function next() {
    stepIdx = (stepIdx + 1) % STEPS.length;
    applyStep(STEPS[stepIdx]);
  }

  function start() {
    const section = document.getElementById('demo-sample');
    if (!section || section.dataset.microDemo === '1') return;
    section.dataset.microDemo = '1';
    applyStep(STEPS[0]);
    timer = setInterval(next, 3600);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.CutupDemoMicro = { start, stop };
})();
