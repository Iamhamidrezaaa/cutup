/**
 * Programmatic SEO guide pages: fetch /api/tools-content, sanitize, CTAs, growth hooks.
 */
(function () {
  var type = (document.documentElement.getAttribute('data-seo-type') || '').trim().toLowerCase();
  if (!type) return;

  var API_BASE = '';
  try {
    API_BASE = window.location && window.location.origin ? window.location.origin : '';
  } catch (_e) {
    API_BASE = '';
  }
  if (!API_BASE || API_BASE === 'null') API_BASE = 'https://cutup.shop';

  var EXIT_KEY = 'cutup_seo_exit_' + type;

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function paragraphsToHtml(text) {
    return String(text || '')
      .split(/\n\n+/)
      .map(function (p) {
        var t = p.trim();
        return t ? '<p>' + escapeHtml(t) + '</p>' : '';
      })
      .filter(Boolean)
      .join('');
  }

  function trackSeo(event, planSuffix) {
    if (typeof sendAnalyticsEvent !== 'function') return;
    var plan = (type + ':' + planSuffix).slice(0, 32);
    var sid = null;
    try {
      sid = localStorage.getItem('cutup_session');
    } catch (_e) {
      sid = null;
    }
    sendAnalyticsEvent(event, { plan: plan, sessionId: sid });
  }

  function ctaHtml(kind, label, primaryHref, secondaryHref, secondaryLabel) {
    var sec = secondaryHref
      ? '<a href="' +
        secondaryHref +
        '" class="btn-secondary" data-seo-cta="' +
        kind +
        '-sec">' +
        escapeHtml(secondaryLabel || 'Pricing') +
        '</a>'
      : '';
    var ctaClass =
      kind === 'final' || kind === 'strong' ? 'strong' : kind === 'mid' ? 'soft' : 'soft';
    return (
      '<div class="seo-guide-cta seo-guide-cta--' +
      ctaClass +
      '">' +
      '<p>' +
      escapeHtml(label) +
      '</p>' +
      '<a href="' +
      primaryHref +
      '" data-seo-cta="' +
      kind +
      '">' +
      'Open the Cutup editor' +
      '</a>' +
      sec +
      '</div>'
    );
  }

  function bindCtas(root) {
    if (!root) return;
    root.querySelectorAll('[data-seo-cta]').forEach(function (a) {
      a.addEventListener('click', function () {
        var slot = a.getAttribute('data-seo-cta') || 'unknown';
        trackSeo('seo_cta_click', slot);
        if (slot === 'final') {
          trackSeo('seo_conversion', 'cta_final');
        }
      });
    });
  }

  var toolHref = '/#tool';
  var pricingHref = '/#pricing';

  function relatedLinksHtml() {
    var guides = [
      { t: 'youtube-to-text', label: 'YouTube to text guide', href: 'youtube-to-text-guide.html' },
      { t: 'instagram-subtitles', label: 'Instagram subtitles guide', href: 'instagram-subtitles-guide.html' },
      {
        t: 'tiktok-caption-generator',
        label: 'TikTok captions guide',
        href: 'tiktok-caption-generator-guide.html',
      },
    ];
    var items = guides
      .filter(function (g) {
        return g.t !== type;
      })
      .map(function (g) {
        return '<li><a href="' + escapeHtml(g.href) + '">' + escapeHtml(g.label) + '</a></li>';
      })
      .join('');
    return (
      '<section class="seo-related" aria-labelledby="seo-related-h">' +
      '<h2 id="seo-related-h">Explore more</h2>' +
      '<ul>' +
      '<li><a href="../tools.html">All Cutup tools</a></li>' +
      '<li><a href="../blog.html">Blog</a></li>' +
      '<li><a href="/">Homepage</a></li>' +
      '<li><a href="' +
      pricingHref +
      '">Pricing</a></li>' +
      items +
      '</ul></section>'
    );
  }

  function render(data) {
    var root = document.getElementById('seoGuideContent');
    if (!root) return;

    var soft = ctaHtml(
      'soft',
      'Try Cutup on your own video—paste a link and preview a transcript in minutes.',
      toolHref,
      pricingHref,
      'See pricing'
    );
    var mid = ctaHtml(
      'mid',
      'Ready to save time? Jump into the editor and export when the draft looks right.',
      toolHref,
      '../tools.html',
      'More tools'
    );
    var fin = ctaHtml(
      'final',
      'Start with Cutup today—fast drafts, simple review, exports when you are happy.',
      toolHref,
      pricingHref,
      'Plans & pricing'
    );

    var benefits =
      Array.isArray(data.benefits) && data.benefits.length
        ? '<ul class="seo-guide-list">' +
          data.benefits
            .map(function (b) {
              return '<li>' + escapeHtml(b) + '</li>';
            })
            .join('') +
          '</ul>'
        : '';

    var useCases =
      Array.isArray(data.useCasesExpanded) && data.useCasesExpanded.length
        ? '<section><h2>Examples & use cases</h2>' +
          data.useCasesExpanded
            .map(function (u) {
              return '<p>' + escapeHtml(u) + '</p>';
            })
            .join('') +
          '</section>'
        : '';

    var examplesExtra =
      Array.isArray(data.examples) && data.examples.length
        ? '<section><h2>Quick examples</h2><ul class="seo-guide-list">' +
          data.examples
            .map(function (x) {
              return '<li>' + escapeHtml(x) + '</li>';
            })
            .join('') +
          '</ul></section>'
        : '';

    var faqs =
      Array.isArray(data.faqsExpanded) && data.faqsExpanded.length
        ? '<section class="seo-guide-faq"><h2>FAQs</h2>' +
          data.faqsExpanded
            .map(function (f) {
              return (
                '<details><summary>' +
                escapeHtml(f.question) +
                '</summary><p>' +
                escapeHtml(f.answer) +
                '</p></details>'
              );
            })
            .join('') +
          '</section>'
        : '';

    root.innerHTML =
      paragraphsToHtml(data.introExpanded || '') +
      soft +
      (data.mistakes
        ? '<section><h2>Common mistakes to avoid</h2>' + paragraphsToHtml(data.mistakes) + '</section>'
        : '') +
      (data.tips ? '<section><h2>Tips for better results</h2>' + paragraphsToHtml(data.tips) + '</section>' : '') +
      examplesExtra +
      mid +
      (data.howItWorks
        ? '<section><h2>How it works</h2>' + paragraphsToHtml(data.howItWorks) + '</section>'
        : '') +
      (benefits ? '<section><h2>Benefits</h2>' + benefits + '</section>' : '') +
      useCases +
      (data.comparison
        ? '<section><h2>How this compares</h2>' + paragraphsToHtml(data.comparison) + '</section>'
        : '') +
      faqs +
      relatedLinksHtml() +
      fin;

    bindCtas(root);

    var viral = document.getElementById('cutupViralReferralBlock');
    if (viral && typeof window.cutupShowViralReferralAfterResult === 'function') {
      viral.hidden = false;
      window.cutupShowViralReferralAfterResult();
    }
  }

  function initExitIntent() {
    try {
      if (sessionStorage.getItem(EXIT_KEY) === '1') return;
    } catch (_e) {
      return;
    }
    var banner = document.getElementById('seoExitBanner');
    if (!banner) return;
    function show() {
      try {
        if (sessionStorage.getItem(EXIT_KEY) === '1') return;
        sessionStorage.setItem(EXIT_KEY, '1');
      } catch (_e2) {
        return;
      }
      banner.classList.add('seo-exit-banner--visible');
      trackSeo('seo_cta_click', 'exit_banner_shown');
    }
    document.addEventListener(
      'mouseout',
      function (e) {
        if (!e.relatedTarget && e.clientY < 12) show();
      },
      { passive: true }
    );
    var cls = banner.querySelector('.seo-exit-close');
    if (cls) {
      cls.addEventListener('click', function () {
        banner.classList.remove('seo-exit-banner--visible');
      });
    }
    banner.querySelectorAll('a[data-seo-exit-cta]').forEach(function (a) {
      a.addEventListener('click', function () {
        trackSeo('seo_cta_click', 'exit_banner');
      });
    });
  }

  function initEmailCapture() {
    var form = document.getElementById('seoEmailForm');
    if (!form) return;
    var msg = document.getElementById('seoEmailMsg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      var email = input && input.value ? String(input.value).trim() : '';
      if (!email) return;
      fetch(API_BASE + '/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: 'seo_guide' }),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return {};
          });
        })
        .then(function (j) {
          if (msg) {
            msg.textContent = j.ok ? 'Thanks — we will keep you posted.' : 'Something went wrong. Try again later.';
          }
          if (j.ok) trackSeo('seo_conversion', 'email');
        })
        .catch(function () {
          if (msg) msg.textContent = 'Network error. Try again later.';
        });
    });
  }

  function load() {
    trackSeo('seo_page_view', 'view');
    var root = document.getElementById('seoGuideContent');
    if (root) root.innerHTML = '<p class="seo-loading">Loading guide…</p>';

    fetch(API_BASE + '/api/tools-content?type=' + encodeURIComponent(type))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || data.error) throw new Error(data && data.error ? data.error : 'empty');
        render(data);
      })
      .catch(function () {
        if (root) {
          root.innerHTML =
            '<p class="seo-loading">This guide could not be loaded. <a href="../tools.html">Browse tools</a> or <a href="/">open the homepage</a>.</p>';
        }
      });

    initExitIntent();
    initEmailCapture();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
