import type { SecureToolExecutor } from '@instalogist/tools';
import type { ToolExecutionOptions, ToolId } from '@instalogist/tools';

const NAME_TO_ID: Record<string, ToolId> = {
  read_workspace: 'read_workspace',
  search_codebase: 'search_codebase',
  create_task: 'create_task',
  read_operational_state: 'read_operational_state',
  get_deployment_status: 'get_deployment_status',
  github_search: 'github_search',
  summarize_logs: 'summarize_logs'
};

export function isInstalogistToolName(name: string): name is keyof typeof NAME_TO_ID {
  return name in NAME_TO_ID;
}

export function toToolId(name: string): ToolId | null {
  return NAME_TO_ID[name] ?? null;
}

export async function invokeInstalogistTool(
  executor: SecureToolExecutor,
  name: string,
  args: Record<string, unknown>,
  options: ToolExecutionOptions
): Promise<{ toolId: ToolId | '__unknown__'; resultJson: string; ok: boolean; code?: string; error?: string }> {
  const id = toToolId(name);
  if (!id) {
    return {
      toolId: '__unknown__',
      resultJson: JSON.stringify({ ok: false, error: `unknown_tool:${name}` }),
      ok: false,
      error: `unknown_tool:${name}`
    };
  }
  const res = await executor.invoke(id, args, options);
  const payload = res.ok
    ? { ok: true, data: res.data, code: res.code }
    : { ok: false, error: res.error, code: res.code };
  return {
    toolId: id,
    resultJson: JSON.stringify(payload),
    ok: res.ok,
    code: res.code,
    error: res.error
  };
}
