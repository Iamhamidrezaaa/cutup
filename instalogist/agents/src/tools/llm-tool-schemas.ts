/**
 * JSON schemas for LLM tool calling (OpenAI function parameters / Anthropic input_schema).
 */
export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const INSTALOGIST_LLM_TOOLS: LlmToolSpec[] = [
  {
    name: 'read_workspace',
    description: 'Read a UTF-8 text file under the Instalogist workspace (path traversal blocked).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path under workspace' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_codebase',
    description: 'Bounded text search across workspace source files.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        under: { type: 'string', description: 'Optional subdirectory' },
        maxFiles: { type: 'number' },
        maxMatchesPerFile: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'create_task',
    description: 'Create a markdown task file under workspace (requires human approval when not dry-run).',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string' },
        title: { type: 'string' },
        bodyMarkdown: { type: 'string' },
        frontmatter: { type: 'object', additionalProperties: true }
      },
      required: ['relativePath', 'title', 'bodyMarkdown']
    }
  },
  {
    name: 'read_operational_state',
    description: 'Read operational state JSON (bounded file).',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_deployment_status',
    description: 'Read-only deployment hints from environment (no cloud deploy API).',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'github_search',
    description: 'GitHub code search via API when token present (requires approval for live calls).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        repo: { type: 'string' }
      },
      required: ['query']
    }
  },
  {
    name: 'summarize_logs',
    description: 'Deterministic extractive summary of log lines (gated; approval for non-dry-run).',
    parameters: {
      type: 'object',
      properties: {
        lines: { type: 'array', items: { type: 'string' } },
        maxLines: { type: 'number' }
      },
      required: ['lines']
    }
  }
];
