import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { getWorkspaceRoot, resolveSafePath } from '../util/paths.js';
import { requireString } from '../util/validation.js';

export interface CreateTaskInput {
  /** Relative path under workspace, e.g. active/tasks/TASK-xxx.md */
  relativePath: string;
  title: string;
  bodyMarkdown: string;
  frontmatter?: Record<string, unknown>;
}

export interface CreateTaskOutput {
  path: string;
  created: boolean;
}

function buildMarkdown(title: string, body: string, fm?: Record<string, unknown>): string {
  const lines = ['---'];
  lines.push(`title: ${JSON.stringify(title)}`);
  lines.push(`created_at: ${JSON.stringify(new Date().toISOString())}`);
  if (fm) {
    for (const [k, v] of Object.entries(fm)) {
      if (k === 'title' || k === 'created_at') continue;
      lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}

export function createCreateTaskTool(): ToolDefinition<CreateTaskInput, CreateTaskOutput> {
  return {
    id: 'create_task' as ToolId,
    description: 'Create a markdown task file under workspace (mutating; requires approval when not dry-run).',
    requiredPermissions: ['tool:write_workspace'],
    requiresApproval: true,
    validateInput(raw: unknown): CreateTaskInput {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid_input_object');
      }
      const o = raw as Record<string, unknown>;
      const fm = o.frontmatter;
      return {
        relativePath: requireString(o.relativePath, 'relativePath'),
        title: requireString(o.title, 'title'),
        bodyMarkdown: requireString(o.bodyMarkdown, 'bodyMarkdown'),
        frontmatter:
          fm != null && typeof fm === 'object' && !Array.isArray(fm) ? (fm as Record<string, unknown>) : undefined
      };
    },
    async execute(
      input: CreateTaskInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<CreateTaskOutput>> {
      const root = getWorkspaceRoot();
      const full = resolveSafePath(input.relativePath, root);
      if (!full.endsWith('.md')) {
        return {
          ok: false,
          toolId: 'create_task',
          dryRun: options.dryRun,
          error: 'path_must_end_with_md',
          code: 'validation_error'
        };
      }
      if (options.dryRun) {
        return {
          ok: true,
          toolId: 'create_task',
          dryRun: true,
          data: { path: full, created: false },
          code: 'ok'
        };
      }
      if (existsSync(full)) {
        return {
          ok: false,
          toolId: 'create_task',
          dryRun: false,
          error: 'file_already_exists',
          code: 'execution_error'
        };
      }
      mkdirSync(path.dirname(full), { recursive: true });
      const md = buildMarkdown(input.title, input.bodyMarkdown, input.frontmatter);
      writeFileSync(full, md, 'utf8');
      return {
        ok: true,
        toolId: 'create_task',
        dryRun: false,
        data: { path: full, created: true },
        code: 'ok'
      };
    }
  };
}
