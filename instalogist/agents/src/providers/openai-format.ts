import type { InternalMessage } from '../execution/internal-messages.js';
import type { LlmToolSpec } from '../tools/llm-tool-schemas.js';

export type OpenAiApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAiMessages(system: string, internal: InternalMessage[]): OpenAiApiMessage[] {
  const out: OpenAiApiMessage[] = [{ role: 'system', content: system }];
  for (const m of internal) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const toolCalls =
        m.toolInvocations?.map((t) => ({
          id: t.id,
          type: 'function' as const,
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) }
        })) ?? undefined;
      const hasTools = !!toolCalls?.length;
      const textPart = m.text?.trim() ? m.text : null;
      if (hasTools) {
        out.push({ role: 'assistant', content: textPart, tool_calls: toolCalls });
      } else {
        out.push({ role: 'assistant', content: textPart ?? '' });
      }
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.resultJson });
    }
  }
  return out;
}

export function toOpenAiToolDefinitions(specs: LlmToolSpec[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return specs.map((s) => ({
    type: 'function' as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters
    }
  }));
}
