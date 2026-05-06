import type { ToolExecutionOptions, ToolId, ToolResult } from './types.js';
import { ToolRegistry } from './registry.js';
import { ToolRateLimiter } from './rate-limit.js';
import { ToolAuditLog } from './audit/tool-audit-log.js';

export interface SecureToolExecutorOptions {
  registry: ToolRegistry;
  rateLimiter: ToolRateLimiter;
  audit: ToolAuditLog;
}

export class SecureToolExecutor {
  constructor(private readonly opts: SecureToolExecutorOptions) {}

  get registry(): ToolRegistry {
    return this.opts.registry;
  }

  async invoke<T = unknown>(toolId: ToolId, input: unknown, options: ToolExecutionOptions): Promise<ToolResult<T>> {
    const def = this.opts.registry.get(toolId);
    if (!def) {
      return {
        ok: false,
        toolId,
        dryRun: options.dryRun,
        code: 'execution_error',
        error: `unknown_tool:${toolId}`
      };
    }

    const gate = this.opts.registry.assertCanInvoke(def, options);
    if (gate) return gate as ToolResult<T>;

    if (!this.opts.rateLimiter.tryConsume(options.caller.principalId, toolId)) {
      const r: ToolResult<T> = {
        ok: false,
        toolId,
        dryRun: options.dryRun,
        code: 'rate_limited',
        error: 'rate_limit_exceeded'
      };
      this.opts.audit.emit({
        ts: new Date().toISOString(),
        toolId,
        principalId: options.caller.principalId,
        dryRun: options.dryRun,
        approvalGranted: options.approvalGranted,
        ok: false,
        code: 'rate_limited'
      });
      return r;
    }

    let parsed: unknown;
    try {
      parsed = def.validateInput(input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const r: ToolResult<T> = {
        ok: false,
        toolId,
        dryRun: options.dryRun,
        code: 'validation_error',
        error: msg
      };
      this.opts.audit.emit({
        ts: new Date().toISOString(),
        toolId,
        principalId: options.caller.principalId,
        dryRun: options.dryRun,
        approvalGranted: options.approvalGranted,
        ok: false,
        code: 'validation_error',
        detail: { message: msg }
      });
      return r;
    }

    let result: ToolResult<T>;
    try {
      result = (await def.execute(parsed, options)) as ToolResult<T>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        ok: false,
        toolId,
        dryRun: options.dryRun,
        code: 'execution_error',
        error: msg
      };
    }

    this.opts.audit.emit({
      ts: new Date().toISOString(),
      toolId,
      principalId: options.caller.principalId,
      dryRun: options.dryRun,
      approvalGranted: options.approvalGranted,
      ok: result.ok,
      code: result.code ?? (result.ok ? 'ok' : 'execution_error'),
      detail: result.ok ? { hasData: result.data != null } : { error: result.error }
    });

    return result;
  }
}
