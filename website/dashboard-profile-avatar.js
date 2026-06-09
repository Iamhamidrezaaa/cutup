/**
 * Profile photo picker with WhatsApp-style circular crop (pan + zoom).
 */
window.CutupProfileAvatar = (function () {
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MIN_IMAGE_PX = 200;
  const OUTPUT_PX = 400;
  const VIEWPORT_PX = 280;
  const ACCEPT = 'image/jpeg,image/png,image/webp';

  let state = null;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function coverScale(img, viewport) {
    return Math.max(viewport / img.naturalWidth, viewport / img.naturalHeight);
  }

  function destroyModal() {
    state?.overlay?.remove();
    state = null;
    document.body.style.overflow = '';
  }

  function drawPreview() {
    if (!state) return;
    const { ctx, img, scale, offsetX, offsetY } = state;
    const w = VIEWPORT_PX;
    const h = VIEWPORT_PX;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const iw = img.naturalWidth * scale;
    const ih = img.naturalHeight * scale;
    const x = w / 2 - iw / 2 + offsetX;
    const y = h / 2 - ih / 2 + offsetY;
    ctx.drawImage(img, x, y, iw, ih);
    ctx.restore();
  }

  function exportCrop() {
    if (!state) return null;
    const { img, scale, offsetX, offsetY } = state;
    const out = document.createElement('canvas');
    out.width = OUTPUT_PX;
    out.height = OUTPUT_PX;
    const ctx = out.getContext('2d');
    const ratio = OUTPUT_PX / VIEWPORT_PX;
    ctx.beginPath();
    ctx.arc(OUTPUT_PX / 2, OUTPUT_PX / 2, OUTPUT_PX / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const iw = img.naturalWidth * scale * ratio;
    const ih = img.naturalHeight * scale * ratio;
    const x = (VIEWPORT_PX / 2 - (img.naturalWidth * scale) / 2 + offsetX) * ratio;
    const y = (VIEWPORT_PX / 2 - (img.naturalHeight * scale) / 2 + offsetY) * ratio;
    ctx.drawImage(img, x, y, iw, ih);
    return out.toDataURL('image/jpeg', 0.85);
  }

  function bindDrag(canvas) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (clientX, clientY) => {
      dragging = true;
      lastX = clientX;
      lastY = clientY;
    };
    const onMove = (clientX, clientY) => {
      if (!dragging || !state) return;
      state.offsetX += clientX - lastX;
      state.offsetY += clientY - lastY;
      lastX = clientX;
      lastY = clientY;
      drawPreview();
    };
    const onUp = () => {
      dragging = false;
    };

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onDown(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);

    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (!e.touches[0]) return;
        onDown(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (!e.touches[0]) return;
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
    canvas.addEventListener('touchend', onUp);
  }

  function openCropModal(file, { onSave, onError } = {}) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      onError?.(`Image must be ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB or smaller.`);
      return;
    }
    if (!ACCEPT.split(',').includes(file.type)) {
      onError?.('Use JPG, PNG, or WebP.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth < MIN_IMAGE_PX || img.naturalHeight < MIN_IMAGE_PX) {
          onError?.(`Image should be at least ${MIN_IMAGE_PX}×${MIN_IMAGE_PX} pixels.`);
          return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'prof-avatar-modal';
        overlay.innerHTML = `
          <div class="prof-avatar-modal__backdrop" data-prof-avatar-close></div>
          <div class="prof-avatar-modal__panel" role="dialog" aria-modal="true" aria-labelledby="profAvatarModalTitle">
            <header class="prof-avatar-modal__head">
              <h3 id="profAvatarModalTitle">Profile photo</h3>
              <button type="button" class="btn ghost prof-avatar-modal__close" data-prof-avatar-close aria-label="Close">×</button>
            </header>
            <p class="prof-avatar-modal__hint">Drag to reposition · use the slider to zoom</p>
            <div class="prof-avatar-modal__stage">
              <canvas class="prof-avatar-modal__canvas" width="${VIEWPORT_PX}" height="${VIEWPORT_PX}" aria-hidden="true"></canvas>
              <div class="prof-avatar-modal__ring" aria-hidden="true"></div>
            </div>
            <label class="prof-avatar-modal__zoom">
              <span>Zoom</span>
              <input type="range" class="prof-avatar-modal__zoom-input" min="100" max="300" value="100" />
            </label>
            <footer class="prof-avatar-modal__actions">
              <button type="button" class="btn ghost" data-prof-avatar-close>Cancel</button>
              <button type="button" class="btn" data-prof-avatar-save>Save photo</button>
            </footer>
          </div>`;

        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        const canvas = overlay.querySelector('.prof-avatar-modal__canvas');
        const ctx = canvas.getContext('2d');
        const base = coverScale(img, VIEWPORT_PX);
        state = {
          overlay,
          img,
          ctx,
          scale: base,
          baseScale: base,
          offsetX: 0,
          offsetY: 0
        };
        drawPreview();
        bindDrag(canvas);

        const zoomInput = overlay.querySelector('.prof-avatar-modal__zoom-input');
        zoomInput?.addEventListener('input', () => {
          if (!state) return;
          const factor = Number(zoomInput.value) / 100;
          state.scale = state.baseScale * factor;
          drawPreview();
        });

        overlay.querySelectorAll('[data-prof-avatar-close]').forEach((el) => {
          el.addEventListener('click', destroyModal);
        });

        overlay.querySelector('[data-prof-avatar-save]')?.addEventListener('click', async () => {
          const dataUrl = exportCrop();
          if (!dataUrl) return;
          const saveBtn = overlay.querySelector('[data-prof-avatar-save]');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
          }
          try {
            await onSave?.(dataUrl);
            destroyModal();
          } catch (e) {
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save photo';
            }
            onError?.(e?.message || 'Upload failed');
          }
        });
      };
      img.onerror = () => onError?.('Could not read this image.');
      img.src = reader.result;
    };
    reader.onerror = () => onError?.('Could not read this file.');
    reader.readAsDataURL(file);
  }

  function pickFile(onFile) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) onFile(file);
    });
    input.click();
  }

  async function uploadCropped(dataUrl) {
    const session =
      (typeof window !== 'undefined' && window.__CUTUP_SESSION__) ||
      localStorage.getItem('cutup_session') ||
      new URLSearchParams(window.location.search).get('session') ||
      '';
    const base =
      typeof API_BASE_URL !== 'undefined' && API_BASE_URL
        ? API_BASE_URL
        : typeof window !== 'undefined' && window.CUTUP_API_BASE
          ? window.CUTUP_API_BASE
          : '';
    const url = `${base}/api/user/avatar`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': session
      },
      body: JSON.stringify({ image: dataUrl, session })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const code = data.error || (res.status === 404 ? 'route_not_found' : 'upload_failed');
      const friendly =
        code === 'invalid_image'
          ? 'Image is too large or unsupported. Try zooming out slightly and save again.'
          : code === 'profile_error'
            ? 'Could not save profile photo. Database may need an update — contact support.'
            : code === 'no_session' || code === 'invalid_session' || code === 'session_expired'
              ? 'Session expired. Please sign in again.'
              : code === 'route_not_found'
                ? 'Upload service is not available yet. Please try again after the site updates.'
                : 'Could not upload profile photo.';
      throw new Error(friendly);
    }
    return data;
  }

  function bindPicker(root, { onUpdated, onError } = {}) {
    const trigger = root.querySelector('[data-prof-avatar-pick]');
    const input = root.querySelector('[data-prof-avatar-input]');
    if (!trigger || !input) return;

    const startPick = () => input.click();

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startPick();
    });

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      openCropModal(file, {
        onSave: async (dataUrl) => {
          const data = await uploadCropped(dataUrl);
          onUpdated?.(data);
        },
        onError: (msg) => onError?.(msg)
      });
    });
  }

  return {
    MAX_FILE_BYTES,
    OUTPUT_PX,
    ACCEPT,
    pickFile,
    openCropModal,
    uploadCropped,
    bindPicker,
    destroyModal
  };
})();
