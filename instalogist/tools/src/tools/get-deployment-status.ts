import type { ToolDefinition, ToolExecutionOptions, ToolResult } from '../registry.js';
import type { ToolId } from '../types.js';
import { optionalString } from '../util/validation.js';

export interface GetDeploymentStatusInput {
  environment?: string;
}

export interface GetDeploymentStatusOutput {
  environment: string;
  /** Read-only posture: no live deploy API calls in this package. */
  readiness: 'unknown' | 'stub_ok' | 'stub_degraded';
  hints: string[];
  /** Optional env flags (never secrets) */
  signals: Record<string, string | boolean>;
}

export function createGetDeploymentStatusTool(): ToolDefinition<
  GetDeploymentStatusInput,
  GetDeploymentStatusOutput
> {
  return {
    id: 'get_deployment_status' as ToolId,
    description: 'Structured deployment posture snapshot (stub — no production control plane).',
    requiredPermissions: ['tool:read_deploy'],
    requiresApproval: false,
    validateInput(raw: unknown): GetDeploymentStatusInput {
      if (raw == null) return {};
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_input_object');
      const o = raw as Record<string, unknown>;
      return { environment: optionalString(o.environment) };
    },
    async execute(
      input: GetDeploymentStatusInput,
      options: ToolExecutionOptions
    ): Promise<ToolResult<GetDeploymentStatusOutput>> {
      const env = input.environment ?? 'production';
      const hasNodeEnv = Boolean(process.env.NODE_ENV);
      const readiness: GetDeploymentStatusOutput['readiness'] = options.dryRun
        ? 'unknown'
        : hasNodeEnv
          ? 'stub_ok'
          : 'stub_degraded';
      return {
        ok: true,
        toolId: 'get_deployment_status',
        dryRun: options.dryRun,
        data: {
          environment: env,
          readiness,
          hints: [
            'This tool does not call cloud APIs. Wire a read-only status provider in integration layer.',
            options.dryRun ? 'dry_run: no signals evaluated' : 'signals derived from process env only'
          ],
          signals: {
            NODE_ENV: process.env.NODE_ENV ?? '(unset)',
            VERCEL: Boolean(process.env.VERCEL),
            CI: Boolean(process.env.CI)
          }
        },
        code: 'ok'
      };
    }
  };
}
