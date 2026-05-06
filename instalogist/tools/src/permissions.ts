import type { ToolPermission } from './types.js';

/** Built-in role → permissions (expand before `invoke`). */
export const ROLE_PERMISSIONS: Record<string, ToolPermission[]> = {
  'agent:readonly': [
    'tool:read_workspace',
    'tool:search_codebase',
    'tool:read_operational',
    'tool:read_deploy'
  ],
  'agent:standard': [
    'tool:read_workspace',
    'tool:search_codebase',
    'tool:read_operational',
    'tool:read_deploy',
    'tool:summarize'
  ],
  'agent:elevated': [
    'tool:read_workspace',
    'tool:search_codebase',
    'tool:write_workspace',
    'tool:read_operational',
    'tool:read_deploy',
    'tool:external_github',
    'tool:summarize'
  ],
  'human:admin': [
    'tool:read_workspace',
    'tool:search_codebase',
    'tool:write_workspace',
    'tool:read_operational',
    'tool:read_deploy',
    'tool:external_github',
    'tool:summarize'
  ]
};

export function expandRolesToPermissions(roles: string[]): Set<ToolPermission> {
  const out = new Set<ToolPermission>();
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r];
    if (perms) for (const p of perms) out.add(p);
  }
  return out;
}

export function buildCaller(principalId: string, roles: string[]): import('./types.js').ToolCaller {
  return {
    principalId,
    permissions: expandRolesToPermissions(roles)
  };
}

export function hasAllPermissions(caller: import('./types.js').ToolCaller, required: ToolPermission[]): boolean {
  for (const p of required) {
    if (!caller.permissions.has(p)) return false;
  }
  return true;
}
