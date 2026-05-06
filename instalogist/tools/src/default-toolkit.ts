import { ToolRegistry } from './registry.js';
import { ToolRateLimiter, DEFAULT_RATE_LIMIT } from './rate-limit.js';
import { ToolAuditLog } from './audit/tool-audit-log.js';
import { SecureToolExecutor } from './executor.js';
import { createReadWorkspaceTool } from './tools/read-workspace.js';
import { createSearchCodebaseTool } from './tools/search-codebase.js';
import { createCreateTaskTool } from './tools/create-task.js';
import { createReadOperationalStateTool } from './tools/read-operational-state.js';
import { createGetDeploymentStatusTool } from './tools/get-deployment-status.js';
import { createGithubSearchTool } from './tools/github-search.js';
import { createSummarizeLogsTool } from './tools/summarize-logs.js';

export interface DefaultToolkit {
  registry: ToolRegistry;
  rateLimiter: ToolRateLimiter;
  audit: ToolAuditLog;
  executor: SecureToolExecutor;
}

export function createDefaultToolkit(rateLimit = DEFAULT_RATE_LIMIT): DefaultToolkit {
  const registry = new ToolRegistry();
  registry.register(createReadWorkspaceTool());
  registry.register(createSearchCodebaseTool());
  registry.register(createCreateTaskTool());
  registry.register(createReadOperationalStateTool());
  registry.register(createGetDeploymentStatusTool());
  registry.register(createGithubSearchTool());
  registry.register(createSummarizeLogsTool());

  const rateLimiter = new ToolRateLimiter(rateLimit);
  const audit = new ToolAuditLog();
  const executor = new SecureToolExecutor({ registry, rateLimiter, audit });
  return { registry, rateLimiter, audit, executor };
}
