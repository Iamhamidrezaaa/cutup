/**
 * Unified Content Studio — shared chrome, media picker, content-type labels.
 * Pages/Blog modules delegate here for consistent UX.
 */
window.CutupUnifiedCMS = (function () {
  const CS = () => window.CutupContentStudio;

  const CONTENT_TYPES = {
    page: { label: 'Page', navKey: 'content-pages' },
    post: { label: 'Article', navKey: 'content-blog' },
    landing: { label: 'Landing page', navKey: 'content-pages' },
    legal: { label: 'Legal page', navKey: 'content-pages' },
    article: { label: 'Article', navKey: 'content-blog' }
  };

  /** Sticky editor chrome: same toolbar pattern for page + post */
  function editorChromeHtml(title, actionsHtml) {
    return `<div class="cs-unified-editor-chrome">
      <div class="cs-unified-editor-chrome-inner">
        <span class="cs-unified-editor-badge">${CS().esc(title)}</span>
        <div class="cs-unified-editor-actions">${actionsHtml}</div>
      </div>
    </div>`;
  }

  /**
   * Open media picker modal; calls onPick({ url, id }) or onPick(null).
   */
  function openMediaPicker(onPick) {
    const Modal = window.CutupMediaModal;
    if (!Modal?.open) {
      onPick?.(null);
      return;
    }
    Modal.open({
      accept: 'image/*',
      title: 'Choose from library',
      onInsert: (item) => onPick?.(item ? { url: item.url, id: item.id } : null),
      onCancel: () => onPick?.(null)
    });
  }

  return { CONTENT_TYPES, editorChromeHtml, openMediaPicker };
})();
