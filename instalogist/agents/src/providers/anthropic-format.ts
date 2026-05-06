import type { InternalMessage } from '../execution/internal-messages.js';
import type { LlmToolSpec } from '../tools/llm-tool-schemas.js';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export type AnthropicApiMessage = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

export function toAnthropicMessages(system: string, internal: InternalMessage[]): {
  system: string;
  messages: AnthropicApiMessage[];
} {
  const messages: AnthropicApiMessage[] = [];
  for (const m of internal) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.text?.trim()) blocks.push({ type: 'text', text: m.text });
      for (const t of m.toolInvocations ?? []) {
        blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input ?? {} });
      }
      messages.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
    } else {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: m.resultJson
          }
        ]
      });
    }
  }
  return { system, messages };
}

export function toAnthropicToolDefinitions(specs: LlmToolSpec[]) {
  return specs.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.parameters
  }));
}
