import YAML from 'yaml';

/**
 * @param {string | null | undefined} text
 * @returns {{ obj: Record<string, unknown> | null, yamlError?: string, warnings: string[] }}
 */
export function parseYamlSafe(text) {
  const warnings = [];
  if (text == null) {
    return { obj: null, warnings };
  }
  if (text.trim() === '') {
    return { obj: {}, warnings };
  }

  try {
    const obj = YAML.parse(text);
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
      return { obj: null, yamlError: 'not_object', warnings };
    }
    return { obj: /** @type {Record<string, unknown>} */ (obj), warnings };
  } catch (e) {
    return {
      obj: null,
      yamlError: e instanceof Error ? e.message : String(e),
      warnings
    };
  }
}
