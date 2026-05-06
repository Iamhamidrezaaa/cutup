import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_MAX_FILE_BYTES } from './constants.mjs';

const SUBDIRS = ['active/tasks', 'active/incidents', 'active/growth'];

/**
 * @param {string} workspaceRootAbsolute
 * @param {{ maxFileSize?: number }} [options]
 * @returns {Promise<Array<{ relativePath: string, absolutePath: string, size: number }>>}
 */
export async function discoverMarkdownFiles(workspaceRootAbsolute, options = {}) {
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_BYTES;
  const resolved = path.resolve(workspaceRootAbsolute);

  /** @type {Array<{ relativePath: string, absolutePath: string, size: number }>} */
  const out = [];

  for (const sub of SUBDIRS) {
    const dir = path.join(resolved, sub);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (name === 'README.md' || !name.endsWith('.md') || name.startsWith('.')) continue;

      const absolutePath = path.join(dir, name);
      const stat = await fs.stat(absolutePath);
      out.push({
        relativePath: toPosix(path.relative(resolved, absolutePath)),
        absolutePath,
        size: stat.size
      });
    }
  }

  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * @param {string} p
 */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * @param {string} workspaceRoot
 * @param {string} relativeOrAbsolute
 * @returns {string | null} resolved absolute path or null if outside root
 */
export function safeResolveUnderRoot(workspaceRoot, relativeOrAbsolute) {
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(relativeOrAbsolute);
  const rel = path.relative(root, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}
