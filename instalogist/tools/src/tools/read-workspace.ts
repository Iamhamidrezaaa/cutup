import { readFileSync, existsSync } from 'node:fs';
import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { getWorkspaceRoot, resolveSafePath } from '../util/paths.js';
import { requireString } from '../util/validation.js';

export interface ReadWorkspaceInput {
  relativePath: string;
}

export interface ReadWorkspaceOutput {
  path: string;
  content: string;
  bytes: number;
}

export function createReadWorkspaceTool(): ToolDefinition<ReadWorkspaceInput, ReadWorkspaceOutput> {
  return {
    id: 'read_workspace' as ToolId,
    description: 'Read a UTF-8 file under the Instalogist workspace root (path validated).',
    requiredPermissions: ['tool:read_workspace'],
    requiresApproval: false,
    validateInput(raw: unknown): ReadWorkspaceInput {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid_input_object');
      }
      const o = raw as Record<string, unknown>;
      return { relativePath: requireString(o.relativePath, 'relativePath') };
    },
    async execute(
      input: ReadWorkspaceInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<ReadWorkspaceOutput>> {
      const root = getWorkspaceRoot();
      const full = resolveSafePath(input.relativePath, root);
      if (options.dryRun) {
        return {
          ok: true,
          toolId: 'read_workspace',
          dryRun: true,
          data: { path: full, content: '', bytes: 0 },
          code: 'ok'
        };
      }
      if (!existsSync(full)) {
        return {
          ok: false,
          toolId: 'read_workspace',
          dryRun: false,
          error: 'file_not_found',
          code: 'execution_error'
        };
      }
      const content = readFileSync(full, 'utf8');
      return {
        ok: true,
        toolId: 'read_workspace',
        dryRun: false,
        data: { path: full, content, bytes: Buffer.byteLength(content, 'utf8') },
        code: 'ok'
      };
    }
  };
}
