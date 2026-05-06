/**
 * Split first YAML frontmatter (--- delimited) from markdown body.
 * @param {string} content
 * @returns {{ frontmatterText: string | null, body: string, error?: string }}
 */
export function extractFrontmatter(content) {
  if (typeof content !== 'string') {
    return { frontmatterText: null, body: '', error: 'not_string' };
  }

  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { frontmatterText: null, body: content };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    return { frontmatterText: null, body: content, error: 'unclosed_frontmatter' };
  }

  const fmLines = lines.slice(1, end);
  const bodyLines = lines.slice(end + 1);
  return {
    frontmatterText: fmLines.join('\n'),
    body: bodyLines.join('\n').replace(/^\n/, '')
  };
}
