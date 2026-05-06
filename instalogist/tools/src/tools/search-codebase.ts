import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { getWorkspaceRoot, resolveSafePath } from '../util/paths.js';
import { requireString, optionalString } from '../util/validation.js';

export interface SearchCodebaseInput {
  query: string;
  /** Search under this subdirectory of workspace (default ".") */
  under?: string;
  maxFiles?: number;
  maxMatchesPerFile?: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  snippet: string;
}

export interface SearchCodebaseOutput {
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
}

function walkFiles(dir: string, limit: number, acc: string[]): void {
  if (acc.length >= limit) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (acc.length >= limit) return;
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(p, limit, acc);
    else if (st.isFile() && acc.length < limit) acc.push(p);
  }
}

export function createSearchCodebaseTool(): ToolDefinition<SearchCodebaseInput, SearchCodebaseOutput> {
  return {
    id: 'search_codebase' as ToolId,
    description: 'Simple text search under workspace (no ripgrep; bounded scan).',
    requiredPermissions: ['tool:search_codebase'],
    requiresApproval: false,
    validateInput(raw: unknown): SearchCodebaseInput {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid_input_object');
      }
      const o = raw as Record<string, unknown>;
      return {
        query: requireString(o.query, 'query'),
        under: optionalString(o.under),
        maxFiles: typeof o.maxFiles === 'number' ? o.maxFiles : 400,
        maxMatchesPerFile: typeof o.maxMatchesPerFile === 'number' ? o.maxMatchesPerFile : 20
      };
    },
    async execute(
      input: SearchCodebaseInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<SearchCodebaseOutput>> {
      const root = getWorkspaceRoot();
      const base = input.under ? resolveSafePath(input.under, root) : root;
      if (!existsSync(base)) {
        return {
          ok: false,
          toolId: 'search_codebase',
          dryRun: options.dryRun,
          error: 'base_path_missing',
          code: 'execution_error'
        };
      }
      const maxFiles = Math.min(2000, Math.max(1, input.maxFiles ?? 400));
      const files: string[] = [];
      walkFiles(base, maxFiles, files);
      const q = input.query.toLowerCase();
      const matches: SearchMatch[] = [];
      let truncated = false;
      const maxTotal = 200;

      if (options.dryRun) {
        return {
          ok: true,
          toolId: 'search_codebase',
          dryRun: true,
          data: { matches: [], filesScanned: files.length, truncated: false },
          code: 'ok'
        };
      }

      outer: for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!['.md', '.ts', '.js', '.mjs', '.json', '.yml', '.yaml', '.txt'].includes(ext)) continue;
        let content: string;
        try {
          content = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        let perFile = 0;
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxTotal) {
            truncated = true;
            break outer;
          }
          if (perFile >= (input.maxMatchesPerFile ?? 20)) break;
          if (lines[i].toLowerCase().includes(q)) {
            matches.push({
              file: path.relative(root, file),
              line: i + 1,
              snippet: lines[i].slice(0, 240)
            });
            perFile++;
          }
        }
      }

      return {
        ok: true,
        toolId: 'search_codebase',
        dryRun: false,
        data: { matches, filesScanned: files.length, truncated },
        code: 'ok'
      };
    }
  };
}
