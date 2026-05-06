import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_MAX_FILE_BYTES } from './constants.mjs';
import { discoverMarkdownFiles } from './discover.mjs';
import { deriveStale } from './derive.mjs';
import { extractFrontmatter } from './extract.mjs';
import { parseYamlSafe } from './parse-yaml.mjs';
import { computeParseStatus, validateFrontmatter } from './validate.mjs';
import { assembleOperationalState, splitFieldsAndExtras } from './assemble.mjs';

/**
 * @param {string} relativePath
 */
function inferEntityType(relativePath) {
  const p = relativePath.replace(/\\/g, '/');
  if (p.includes('active/tasks/')) return 'task';
  if (p.includes('active/incidents/')) return 'incident';
  if (p.includes('active/growth/')) return 'growth';
  return 'task';
}

/**
 * @param {object} opts
 * @param {string} opts.workspaceRootAbsolute
 * @param {Date} opts.now
 * @param {boolean} [opts.lite]
 * @param {boolean} [opts.verbose]
 * @param {number} [opts.maxFileSize]
 */
export async function runParser(opts) {
  const {
    workspaceRootAbsolute,
    now,
    lite = false,
    verbose = false,
    maxFileSize = DEFAULT_MAX_FILE_BYTES
  } = opts;

  const root = path.resolve(workspaceRootAbsolute);
  const scanErrors = [];
  /** @type {object[]} */
  const items = [];

  let files;
  try {
    files = await discoverMarkdownFiles(root, { maxFileSize });
  } catch (e) {
    scanErrors.push({
      message: e instanceof Error ? e.message : String(e),
      path: root
    });
    return assembleOperationalState({
      workspaceRootAbsolute: root,
      generatedAtIso: now.toISOString(),
      items: [],
      scanErrors
    });
  }

  for (const file of files) {
    if (file.size > maxFileSize) {
      const msg = `file exceeds max size (${file.size} > ${maxFileSize})`;
      scanErrors.push({ message: msg, path: file.relativePath });
      items.push({
        source_path: file.relativePath,
        entity_type: inferEntityType(file.relativePath),
        parse_status: 'degraded',
        fields: {},
        extras: {},
        validation: {
          errors: [{ rule: 'SIZE', message: msg }],
          warnings: []
        },
        derived: { stale: false, blocked_stale: false, days_since_update: null },
        ...(lite ? {} : { body_markdown: null })
      });
      if (verbose) console.error(`[instalogist-parser] ${file.relativePath}: ${msg}`);
      continue;
    }

    let content;
    try {
      content = await fs.readFile(file.absolutePath, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      scanErrors.push({ message: msg, path: file.relativePath });
      items.push({
        source_path: file.relativePath,
        entity_type: inferEntityType(file.relativePath),
        parse_status: 'degraded',
        fields: {},
        extras: {},
        validation: {
          errors: [{ rule: 'READ', message: msg }],
          warnings: []
        },
        derived: { stale: false, blocked_stale: false, days_since_update: null }
      });
      if (verbose) console.error(`[instalogist-parser] ${file.relativePath}: READ ${msg}`);
      continue;
    }

    const emptyFile = content.trim() === '';
    const extracted = extractFrontmatter(content);

    /** @type {Record<string, unknown>} */
    let rawObj = {};
    /** @type {{ errors: { rule: string, message: string }[], warnings: { rule: string, message: string }[] }} */
    let validation = { errors: [], warnings: [] };
    let extractFailed = false;
    let yamlFailed = false;
    /** @type {string[]} */
    let yamlWarnings = [];

    if (emptyFile) {
      validation = { errors: [], warnings: [] };
    } else if (extracted.error === 'unclosed_frontmatter') {
      extractFailed = true;
      yamlFailed = true;
      validation = { errors: [], warnings: [] };
      validation.errors.push({
        rule: 'EXTRACT',
        message: 'Unclosed frontmatter delimiter'
      });
    } else if (extracted.frontmatterText === null && !extracted.error) {
      rawObj = {};
      validation = validateFrontmatter(rawObj);
    } else if (extracted.frontmatterText != null) {
      const yamlResult = parseYamlSafe(extracted.frontmatterText);
      yamlWarnings = yamlResult.warnings;
      if (yamlResult.obj) {
        rawObj = yamlResult.obj;
        validation = validateFrontmatter(rawObj);
      } else {
        yamlFailed = true;
        validation = { errors: [], warnings: [] };
        validation.errors.push({
          rule: 'YAML',
          message: yamlResult.yamlError || 'parse_failed'
        });
      }
    }

    validation.warnings = [...validation.warnings, ...yamlWarnings.map((m) => ({ rule: 'YAML-WARN', message: m }))];

    const parse_status = computeParseStatus(validation, yamlFailed, extractFailed, emptyFile);

    const { fields, extras } =
      emptyFile || yamlFailed || extractFailed
        ? { fields: {}, extras: {} }
        : splitFieldsAndExtras(rawObj);

    const statusStr = typeof fields.status === 'string' ? fields.status : undefined;
    const updatedStr = typeof fields.updated_at === 'string' ? fields.updated_at : undefined;
    const derived = deriveStale(updatedStr, statusStr, now);

    const item = {
      source_path: file.relativePath,
      entity_type: inferEntityType(file.relativePath),
      parse_status,
      fields,
      validation: {
        errors: validation.errors,
        warnings: validation.warnings
      },
      derived,
      extras
    };

    if (!lite) {
      item.body_markdown = extracted.body ?? content;
    }

    items.push(item);

    if (verbose) {
      for (const err of validation.errors) {
        console.error(`[instalogist-parser] ${file.relativePath}: ${err.rule} ${err.message}`);
      }
      for (const w of validation.warnings) {
        console.error(`[instalogist-parser] ${file.relativePath}: ${w.rule} ${w.message} (warning)`);
      }
    }
  }

  return assembleOperationalState({
    workspaceRootAbsolute: root,
    generatedAtIso: now.toISOString(),
    items,
    scanErrors
  });
}
