import { realpathSync } from 'node:fs';
import path from 'node:path';

export function getWorkspaceRoot(): string {
  const raw = process.env.INSTALOGIST_WORKSPACE_ROOT?.trim();
  if (raw) return path.resolve(raw);
  return path.resolve(process.cwd(), 'instalogist', 'workspace');
}

export function resolveSafePath(relativePath: string, root: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const joined = path.resolve(root, normalized);
  const rootReal = safeRealpath(root);
  const joinedReal = safeRealpath(joined);
  if (!joinedReal.startsWith(rootReal + path.sep) && joinedReal !== rootReal) {
    throw new Error('path_escape_workspace');
  }
  return joinedReal;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
