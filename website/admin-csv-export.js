/**
 * Shared CSV download helpers for admin dashboards.
 */
window.CutupAdminCsv = (function () {
  function cell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function row(values) {
    return (Array.isArray(values) ? values : []).map(cell).join(',');
  }

  /**
   * @param {string} filename
   * @param {string[]} header
   * @param {Array<string|number|null|undefined>[]} rows
   */
  function download(filename, header, rows) {
    const lines = [row(header), ...(rows || []).map((r) => row(r))];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /**
   * @param {string} filename
   * @param {{ key: string, header: string }[]} columns
   * @param {object[]} objects
   */
  function downloadObjects(filename, columns, objects) {
    const header = columns.map((c) => c.header);
    const rows = (objects || []).map((obj) => columns.map((c) => obj[c.key]));
    download(filename, header, rows);
  }

  /**
   * Flat multi-section export: section label + aligned fields.
   * @param {string} filename
   * @param {string[]} fieldHeaders e.g. ['field_a','field_b',...]
   * @param {Array<{ section: string, fields: unknown[] }>} sections
   */
  function downloadSections(filename, fieldHeaders, sections) {
    const header = ['section', ...fieldHeaders];
    const rows = [];
    for (const block of sections || []) {
      for (const fields of block.rows || []) {
        rows.push([block.section, ...fields]);
      }
    }
    download(filename, header, rows);
  }

  return { cell, row, download, downloadObjects, downloadSections };
})();
