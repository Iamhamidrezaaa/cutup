import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { optionalString } from '../util/validation.js';

export interface ReadOperationalStateInput {
  /** Absolute or relative path to operational-state.json */
  path?: string;
}

export interface ReadOperationalStateOutput {
  path: string;
  contractId?: string;
  generatedAt?: string;
  itemCount: number;
  snapshotStatus?: string;
  /** Full JSON when small; omit large bodies in future via maxBytes */
  raw?: unknown;
}

function defaultOperationalPath(): string {
  const env = process.env.INSTALOGIST_OPERATIONAL_STATE_PATH?.trim();
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), 'instalogist', 'parser', 'example', 'operational-state.example.json');
}

export function createReadOperationalStateTool(): ToolDefinition<
  ReadOperationalStateInput,
  ReadOperationalStateOutput
> {
  return {
    id: 'read_operational_state' as ToolId,
    description: 'Read Instalogist operational-state JSON (bounded).',
    requiredPermissions: ['tool:read_operational'],
    requiresApproval: false,
    validateInput(raw: unknown): ReadOperationalStateInput {
      if (raw == null) return {};
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_input_object');
      const o = raw as Record<string, unknown>;
      return { path: optionalString(o.path) };
    },
    async execute(
      input: ReadOperationalStateInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<ReadOperationalStateOutput>> {
      const p = input.path ? path.resolve(input.path) : defaultOperationalPath();
      if (options.dryRun) {
        return {
          ok: true,
          toolId: 'read_operational_state',
          dryRun: true,
          data: { path: p, itemCount: 0 },
          code: 'ok'
        };
      }
      if (!existsSync(p)) {
        return {
          ok: false,
          toolId: 'read_operational_state',
          dryRun: false,
          error: 'file_not_found',
          code: 'execution_error'
        };
      }
      const text = readFileSync(p, 'utf8');
      const max = 2_000_000;
      if (text.length > max) {
        return {
          ok: false,
          toolId: 'read_operational_state',
          dryRun: false,
          error: 'file_too_large',
          code: 'execution_error'
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          ok: false,
          toolId: 'read_operational_state',
          dryRun: false,
          error: 'invalid_json',
          code: 'execution_error'
        };
      }
      const rec = parsed as Record<string, unknown>;
      const items = Array.isArray(rec.items) ? rec.items.length : 0;
      return {
        ok: true,
        toolId: 'read_operational_state',
        dryRun: false,
        data: {
          path: p,
          contractId: typeof rec.contract_id === 'string' ? rec.contract_id : undefined,
          generatedAt: typeof rec.generated_at === 'string' ? rec.generated_at : undefined,
          snapshotStatus: typeof rec.snapshot_status === 'string' ? rec.snapshot_status : undefined,
          itemCount: items,
          raw: parsed
        },
        code: 'ok'
      };
    }
  };
}
