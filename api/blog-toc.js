/**
 * Extract h2/h3 headings with id attributes for editorial TOC.
 */
export function extractTocFromHtml(html) {
  const items = [];
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const level = Number(m[1]);
    const id = m[2];
    const label = stripTags(m[3]).trim();
    if (id && label) items.push({ id, label, level });
  }
  return items;
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderTocHtml(tocItems) {
  if (!tocItems?.length) {
    return `<nav class="ba-toc" id="baToc" aria-label="Table of contents">
      <span class="ba-toc-label">On this page</span>
      <p style="margin:0;color:var(--ba-muted);font-size:13px;">No sections</p>
    </nav>`;
  }
  const links = tocItems
    .map((item) => `<li><a href="#${escapeAttr(item.id)}">${escapeHtml(item.label)}</a></li>`)
    .join('');
  return `<nav class="ba-toc" id="baToc" aria-label="Table of contents">
    <span class="ba-toc-label">On this page</span>
    <ol class="ba-toc-list">${links}</ol>
  </nav>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
