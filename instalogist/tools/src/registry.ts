import type { ToolExecutionOptions, ToolId, ToolPermission, ToolResult } from './types.js';
import { hasAllPermissions } from './permissions.js';

export type { ToolExecutionOptions, ToolId, ToolPermission, ToolResult, ToolCaller } from './types.js';

export interface ToolDefinition<TIn, TOut> {
  id: ToolId;
  description: string;
  requiredPermissions: ToolPermission[];
  /** If true: non-dry-run requires `options.approvalGranted`. */
  requiresApproval: boolean;
  validateInput(raw: unknown): TIn;
  execute(input: TIn, options: ToolExecutionOptions): Promise<ToolResult<TOut>>;
}

export class ToolRegistry {
  private readonly tools = new Map<ToolId, ToolDefinition<unknown, unknown>>();

  register<TIn, TOut>(def: ToolDefinition<TIn, TOut>): void {
    this.tools.set(def.id, def as ToolDefinition<unknown, unknown>);
  }

  get(id: ToolId): ToolDefinition<unknown, unknown> | undefined {
    return this.tools.get(id);
  }

  list(): ToolDefinition<unknown, unknown>[] {
    return [...this.tools.values()];
  }

  assertCanInvoke(
    def: ToolDefinition<unknown, unknown>,
    options: ToolExecutionOptions
  ): ToolResult<never> | null {
    if (!hasAllPermissions(options.caller, def.requiredPermissions)) {
      return {
        ok: false,
        toolId: def.id,
        dryRun: options.dryRun,
        code: 'permission_denied',
        error: 'missing_required_permissions'
      };
    }
    if (def.requiresApproval && !options.dryRun && !options.approvalGranted) {
      return {
        ok: false,
        toolId: def.id,
        dryRun: options.dryRun,
        code: 'approval_required',
        error: 'dangerous_tool_requires_approval_mode'
      };
    }
    return null;
  }
}
