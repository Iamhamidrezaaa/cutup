/**
 * Creator Wall — compact showcase + live social proof layer
 */
(function (global) {
  'use strict';

  const MAX_DISPLAY = 5;
  const PLATFORM_LABELS = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    podcast: 'Podcast'
  };

  let lastFeedIds = '';
  let pollTimer = null;
  let draftPreview = null;
  let cachedPosts = [];

  function countryFlag(code) {
    const c = String(code || 'US').toUpperCase();
    if (c.length !== 2) return '🌍';
    return String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
  }

  function formatRelativeTime(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildFrame(post, compact) {
    if (global.CutupCreatorWallFrames?.buildExportFrame) {
      return global.CutupCreatorWallFrames.buildExportFrame(post, compact);
    }
    return `<div class="cw-export-frame cw-export-frame--compact"><div class="cw-export-frame__viewport"></div></div>`;
  }

  function metaBits(post) {
    const platform = PLATFORM_LABELS[post.platform] || post.platform || '';
    const views = post.statsJson?.views ? `${post.statsJson.views} views` : '';
    const time = formatRelativeTime(post.createdAt);
    return [countryFlag(post.countryCode), platform, views, time].filter(Boolean).join(' · ');
  }

  function pickShowcase(posts) {
    const list = posts.slice(0, 12);
    if (!list.length) return { featured: null, secondary: [] };
    const featured = list.find((p) => p.featured) || list[0];
    const secondary = list.filter((p) => p.id !== featured.id).slice(0, MAX_DISPLAY - 1);
    return { featured, secondary };
  }

  function buildFeaturedCard(post) {
    const isDraft = post.id === 'draft-preview';
    const label = escapeHtml(post.presetLabel || post.stylePreset);
    const handle = post.socialHandle
      ? escapeHtml(post.socialHandle)
      : escapeHtml(post.creatorName || 'Creator');
    return `
      <article class="cw-card cw-card--featured${isDraft ? ' cw-card--draft' : ''}" data-preset="${escapeHtml(post.stylePreset)}" itemscope itemtype="https://schema.org/CreativeWork">
        <div class="cw-card__media">${buildFrame(post, false)}</div>
        <div class="cw-card__body">
          <span class="cw-badge${isDraft ? ' cw-badge--draft' : ''}">${isDraft ? 'Your preview' : label}</span>
          <p class="cw-card__quote" itemprop="description">“${escapeHtml(post.feedback)}”</p>
          <div class="cw-meta">
            <span>${handle}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(metaBits(post))}</span>
          </div>
          <button type="button" class="cw-btn" data-cw-use-style="${escapeHtml(post.stylePreset)}">Use this style</button>
        </div>
      </article>`;
  }

  function buildCompactCard(post) {
    const label = escapeHtml(post.presetLabel || post.stylePreset);
    return `
      <article class="cw-card cw-card--compact" data-preset="${escapeHtml(post.stylePreset)}" tabindex="0" role="button" itemscope itemtype="https://schema.org/CreativeWork">
        <div class="cw-card__media">${buildFrame(post, true)}</div>
        <div class="cw-card__body">
          <span class="cw-badge">${label}</span>
          <p class="cw-card__quote" itemprop="description">${escapeHtml(post.feedback)}</p>
        </div>
      </article>`;
  }

  function showToast(msg) {
    let toast = document.getElementById('creatorWallToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'creatorWallToast';
      toast.className = 'creator-wall__toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('creator-wall__toast--visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('creator-wall__toast--visible'), 2800);
  }

  function useStyle(presetId) {
    const id = presetId || 'hormozi';
    if (global.CutupPresetSelector?.setActivePresetId) {
      global.CutupPresetSelector.setActivePresetId(id);
    } else {
      try {
        localStorage.setItem('cutup_style_preset', id);
      } catch {
        /* ignore */
      }
      global.cutupActiveStylePreset = id;
    }
    const mount = document.getElementById('cutupStylePresetsMount');
    if (mount && global.CutupPresetSelector?.mount) {
      global.CutupPresetSelector.mount(mount, {
        onChange: () => global.CutupSubtitleStyles?.refreshPreview?.()
      });
    }
    global.CutupSubtitleStyles?.refreshPreview?.();
    document.getElementById('tool')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    showToast('Style applied');
    global.trackEvent?.('creator_wall_use_style', { presetId: id }, 'product');
  }

  function wireInteractions(root) {
    root.querySelectorAll('[data-cw-use-style]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        useStyle(btn.getAttribute('data-cw-use-style'));
      });
    });
    root.querySelectorAll('.cw-card--compact').forEach((card) => {
      const activate = () => useStyle(card.getAttribute('data-preset'));
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  function presetLabelFor(id) {
    return global.CutupStylePresets?.PRESETS?.[id]?.name || String(id || 'hormozi');
  }

  function setDraftPreview(draft) {
    if (!draft) return;
    draftPreview = {
      id: 'draft-preview',
      featured: true,
      stylePreset: draft.stylePreset || 'hormozi',
      presetLabel: presetLabelFor(draft.stylePreset),
      feedback: String(draft.feedback || '').trim() || 'Your quote appears here as you type.',
      creatorName: String(draft.creatorName || '').trim(),
      socialHandle: String(draft.socialHandle || '').trim(),
      platform: draft.platform || 'youtube',
      countryCode: draft.countryCode || 'US',
      createdAt: new Date().toISOString()
    };
    renderShowcase(cachedPosts);
    document.getElementById('creator-wall')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function clearDraftPreview() {
    draftPreview = null;
    renderShowcase(cachedPosts);
  }

  function renderShowcase(posts) {
    const host = document.getElementById('creatorWallShowcase');
    if (!host) return;

    cachedPosts = Array.isArray(posts) ? posts : [];
    const merged = draftPreview
      ? [draftPreview, ...cachedPosts.filter((p) => p && p.id !== 'draft-preview')]
      : cachedPosts;

    const { featured, secondary } = pickShowcase(merged);
    if (!featured) {
      host.innerHTML = '';
      host.classList.remove('creator-wall__showcase--ready', 'creator-wall__showcase--loading');
      host.setAttribute('aria-busy', 'false');
      return;
    }

    const rail =
      secondary.length > 0
        ? `<div class="creator-wall__rail">${secondary.map(buildCompactCard).join('')}</div>`
        : '';

    host.classList.remove('creator-wall__showcase--loading');
    host.innerHTML = buildFeaturedCard(featured) + rail;
    host.classList.add('creator-wall__showcase--ready');
    host.setAttribute('aria-busy', 'false');

    wireInteractions(host);

    const ids = [featured.id, ...secondary.map((p) => p.id)].join(',');
    if (lastFeedIds && ids !== lastFeedIds) showToast('New creator export');
    lastFeedIds = ids;
  }

  function injectJsonLd(posts) {
    let el = document.getElementById('creatorWallJsonLd');
    if (!el) {
      el = document.createElement('script');
      el.id = 'creatorWallJsonLd';
      el.type = 'application/ld+json';
      document.head.appendChild(el);
    }
    const { featured, secondary } = pickShowcase(posts);
    const all = featured ? [featured, ...secondary] : [];
    el.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Cutup Creator Wall',
      itemListElement: all.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: { '@type': 'CreativeWork', name: p.presetLabel, description: p.feedback }
      }))
    });
  }

  async function fetchAll() {
    const [feedRes, statsRes] = await Promise.all([
      fetch('/api/creator-wall?action=feed&limit=8'),
      fetch('/api/creator-wall?action=stats')
    ]);
    const feed = await feedRes.json().catch(() => ({}));
    const stats = await statsRes.json().catch(() => ({}));

    if (feed.ok && Array.isArray(feed.posts)) {
      renderShowcase(feed.posts);
      injectJsonLd(feed.posts);
    }

    if (stats.ok && stats.stats && global.CutupCreatorWallLive?.startLiveLayer) {
      global.CutupCreatorWallLive.startLiveLayer(stats.stats);
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      fetch('/api/creator-wall?action=feed&limit=8')
        .then((r) => r.json())
        .then((d) => {
          if (d.ok && Array.isArray(d.posts)) renderShowcase(d.posts);
        })
        .catch(() => {});
      global.CutupCreatorWallLive?.resyncMetrics?.();
    }, 120000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    global.CutupCreatorWallLive?.stopLiveLayer?.();
  }

  function init() {
    const section = document.getElementById('creator-wall');
    if (!section || section.dataset.initialized === '1') return;
    section.dataset.initialized = '1';

    const host = document.getElementById('creatorWallShowcase');
    if (host) host.setAttribute('aria-busy', 'true');

    fetchAll().catch((err) => console.warn('[creator-wall]', err));
    startPolling();
  }

  global.CutupCreatorWall = {
    init,
    useStyle,
    stopPolling,
    renderShowcase,
    setDraftPreview,
    clearDraftPreview
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
