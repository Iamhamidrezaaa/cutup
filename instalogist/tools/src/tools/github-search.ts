import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { requireString, optionalString } from '../util/validation.js';

export interface GithubSearchInput {
  query: string;
  /** owner/repo optional scope */
  repo?: string;
}

export interface GithubSearchOutput {
  query: string;
  items: Array<{ path: string; url?: string; snippet?: string }>;
  note: string;
}

/**
 * Dangerous: external network + token surface. Requires approval for non-dry-run.
 * Without GITHUB_TOKEN returns structured empty result (safe default).
 */
export function createGithubSearchTool(): ToolDefinition<GithubSearchInput, GithubSearchOutput> {
  return {
    id: 'github_search' as ToolId,
    description: 'GitHub code search (requires GITHUB_TOKEN; approval for live calls).',
    requiredPermissions: ['tool:external_github'],
    requiresApproval: true,
    validateInput(raw: unknown): GithubSearchInput {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid_input_object');
      }
      const o = raw as Record<string, unknown>;
      return { query: requireString(o.query, 'query'), repo: optionalString(o.repo) };
    },
    async execute(
      input: GithubSearchInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<GithubSearchOutput>> {
      const token = process.env.GITHUB_TOKEN?.trim();
      if (options.dryRun) {
        return {
          ok: true,
          toolId: 'github_search',
          dryRun: true,
          data: {
            query: input.query,
            items: [],
            note: 'dry_run: would call GitHub search API if token present and approval granted'
          },
          code: 'ok'
        };
      }
      if (!token) {
        return {
          ok: true,
          toolId: 'github_search',
          dryRun: false,
          data: {
            query: input.query,
            items: [],
            note: 'GITHUB_TOKEN not set — no network call performed (safe default).'
          },
          code: 'ok'
        };
      }
      // Approval already enforced by executor for dangerous tools.
      const q = encodeURIComponent(`${input.query} repo:${input.repo ?? ''}`.trim());
      const url = `https://api.github.com/search/code?q=${q}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        clearTimeout(t);
        if (!res.ok) {
          return {
            ok: false,
            toolId: 'github_search',
            dryRun: false,
            error: `github_http_${res.status}`,
            code: 'execution_error'
          };
        }
        const json = (await res.json()) as { items?: Array<{ path: string; html_url?: string }> };
        const items = (json.items ?? []).slice(0, 20).map((it) => ({
          path: it.path,
          url: it.html_url
        }));
        return {
          ok: true,
          toolId: 'github_search',
          dryRun: false,
          data: { query: input.query, items, note: 'live GitHub search' },
          code: 'ok'
        };
      } catch (e) {
        clearTimeout(t);
        return {
          ok: false,
          toolId: 'github_search',
          dryRun: false,
          error: e instanceof Error ? e.message : String(e),
          code: 'execution_error'
        };
      }
    }
  };
}
