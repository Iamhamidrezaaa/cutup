import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { optionalStringArray } from '../util/validation.js';

export interface SummarizeLogsInput {
  lines: string[];
  maxLines?: number;
}

export interface SummarizeLogsOutput {
  summary: string;
  lineCount: number;
  /** Stub: no LLM — deterministic extractive summary only. */
  mode: 'extractive_stub';
}

/**
 * Marked dangerous: cost / data exfil risk when wired to LLM. Approval for non-dry-run.
 * Current implementation is local extractive only (no external calls).
 */
export function createSummarizeLogsTool(): ToolDefinition<SummarizeLogsInput, SummarizeLogsOutput> {
  return {
    id: 'summarize_logs' as ToolId,
    description: 'Summarize log lines (extractive stub; swap for LLM behind same gate).',
    requiredPermissions: ['tool:summarize'],
    requiresApproval: true,
    validateInput(raw: unknown): SummarizeLogsInput {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid_input_object');
      }
      const o = raw as Record<string, unknown>;
      const lines = optionalStringArray(o.lines);
      if (!lines?.length) throw new Error('lines_required');
      return {
        lines,
        maxLines: typeof o.maxLines === 'number' ? o.maxLines : 500
      };
    },
    async execute(
      input: SummarizeLogsInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<SummarizeLogsOutput>> {
      const max = Math.min(5000, Math.max(1, input.maxLines ?? 500));
      const slice = input.lines.slice(0, max);
      if (options.dryRun) {
        return {
          ok: true,
          toolId: 'summarize_logs',
          dryRun: true,
          data: {
            summary: '',
            lineCount: slice.length,
            mode: 'extractive_stub'
          },
          code: 'ok'
        };
      }
      const errors = slice.filter((l) => /\berror\b|\bfatal\b|\bexception\b/i.test(l)).slice(0, 15);
      const summary =
        `Lines: ${slice.length}. ` +
        (errors.length
          ? `Sample errors (${errors.length}): ${errors.join(' | ').slice(0, 1200)}`
          : 'No obvious error keywords in sample.');
      return {
        ok: true,
        toolId: 'summarize_logs',
        dryRun: false,
        data: { summary, lineCount: slice.length, mode: 'extractive_stub' },
        code: 'ok'
      };
    }
  };
}
