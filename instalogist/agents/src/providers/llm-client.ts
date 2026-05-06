import type { InternalMessage } from '../execution/internal-messages.js';
import type { LlmToolSpec } from '../tools/llm-tool-schemas.js';
import type { LlmProviderKind, TokenUsage } from '../types.js';

export interface LlmTurnResult {
  text: string;
  toolInvocations: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  usage: TokenUsage;
}

export interface LlmClient {
  readonly kind: LlmProviderKind;
  completeTurn(params: {
    system: string;
    internalMessages: InternalMessage[];
    tools: LlmToolSpec[];
    maxOutputTokens: number;
    model: string;
    stream: boolean;
    onTextDelta?: (chunk: string) => void;
  }): Promise<LlmTurnResult>;
}

function safeJsonParseObject(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

export class OpenAiClient implements LlmClient {
  readonly kind = 'openai' as const;
  constructor(private readonly apiKey: string) {}

  async completeTurn(params: {
    system: string;
    internalMessages: InternalMessage[];
    tools: LlmToolSpec[];
    maxOutputTokens: number;
    model: string;
    stream: boolean;
    onTextDelta?: (chunk: string) => void;
  }): Promise<LlmTurnResult> {
    const { toOpenAiMessages, toOpenAiToolDefinitions } = await import('./openai-format.js');
    const messages = toOpenAiMessages(params.system, params.internalMessages);
    const tools = toOpenAiToolDefinitions(params.tools);
    if (params.stream) {
      return openAiStreamCompletion({
        apiKey: this.apiKey,
        model: params.model,
        messages,
        tools,
        maxOutputTokens: params.maxOutputTokens,
        onTextDelta: params.onTextDelta
      });
    }
    return openAiSyncCompletion({
      apiKey: this.apiKey,
      model: params.model,
      messages,
      tools,
      maxOutputTokens: params.maxOutputTokens
    });
  }
}

async function openAiSyncCompletion(opts: {
  apiKey: string;
  model: string;
  messages: import('./openai-format.js').OpenAiApiMessage[];
  tools: ReturnType<typeof import('./openai-format.js').toOpenAiToolDefinitions>;
  maxOutputTokens: number;
}): Promise<LlmTurnResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxOutputTokens
  };
  if (opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai_http_${res.status}:${err.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = json.choices?.[0]?.message;
  const text = msg?.content ?? '';
  const toolInvocations = (msg?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: safeJsonParseObject(tc.function.arguments)
  }));
  return {
    text,
    toolInvocations,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0
    }
  };
}

async function openAiStreamCompletion(opts: {
  apiKey: string;
  model: string;
  messages: import('./openai-format.js').OpenAiApiMessage[];
  tools: ReturnType<typeof import('./openai-format.js').toOpenAiToolDefinitions>;
  maxOutputTokens: number;
  onTextDelta?: (chunk: string) => void;
}): Promise<LlmTurnResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai_http_${res.status}:${err.slice(0, 500)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('openai_no_response_body');
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  type Agg = { id?: string; name?: string; args: string };
  const toolMap = new Map<number, Agg>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const data = t.slice(6);
      if (data === '[DONE]') continue;
      let chunk: {
        choices?: Array<{
          delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
          finish_reason?: string | null;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
        continue;
      }
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        opts.onTextDelta?.(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        let a = toolMap.get(idx);
        if (!a) {
          a = { args: '' };
          toolMap.set(idx, a);
        }
        if (tc.id) a.id = tc.id;
        if (tc.function?.name) a.name = tc.function.name;
        if (tc.function?.arguments) a.args += tc.function.arguments;
      }
    }
  }

  const toolInvocations = [...toolMap.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([, v]) => ({
      id: v.id ?? `call_${Math.random().toString(36).slice(2)}`,
      name: v.name ?? 'unknown',
      input: safeJsonParseObject(v.args)
    }));

  return { text, toolInvocations, usage };
}

export class AnthropicClient implements LlmClient {
  readonly kind = 'anthropic' as const;
  constructor(private readonly apiKey: string) {}

  async completeTurn(params: {
    system: string;
    internalMessages: InternalMessage[];
    tools: LlmToolSpec[];
    maxOutputTokens: number;
    model: string;
    stream: boolean;
    onTextDelta?: (chunk: string) => void;
  }): Promise<LlmTurnResult> {
    if (params.stream) {
      return anthropicStreamCompletion(this.apiKey, params);
    }
    return anthropicSyncCompletion(this.apiKey, params);
  }
}

async function anthropicSyncCompletion(
  apiKey: string,
  params: {
    system: string;
    internalMessages: InternalMessage[];
    tools: LlmToolSpec[];
    maxOutputTokens: number;
    model: string;
  }
): Promise<LlmTurnResult> {
  const { toAnthropicMessages, toAnthropicToolDefinitions } = await import('./anthropic-format.js');
  const { system, messages } = toAnthropicMessages(params.system, params.internalMessages);
  const tools = toAnthropicToolDefinitions(params.tools);
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxOutputTokens,
    system,
    messages
  };
  if (tools.length) body.tools = tools;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`anthropic_http_${res.status}:${err.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{
      type: string;
      id?: string;
      name?: string;
      input?: unknown;
      text?: string;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  let text = '';
  const toolInvocations: LlmTurnResult['toolInvocations'] = [];
  for (const b of json.content ?? []) {
    if (b.type === 'text' && b.text) text += b.text;
    if (b.type === 'tool_use' && b.id && b.name) {
      const input =
        b.input && typeof b.input === 'object' && !Array.isArray(b.input)
          ? (b.input as Record<string, unknown>)
          : {};
      toolInvocations.push({ id: b.id, name: b.name, input });
    }
  }
  return {
    text,
    toolInvocations,
    usage: {
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0
    }
  };
}

async function anthropicStreamCompletion(
  apiKey: string,
  params: {
    system: string;
    internalMessages: InternalMessage[];
    tools: LlmToolSpec[];
    maxOutputTokens: number;
    model: string;
    onTextDelta?: (chunk: string) => void;
  }
): Promise<LlmTurnResult> {
  const { toAnthropicMessages, toAnthropicToolDefinitions } = await import('./anthropic-format.js');
  const { system, messages } = toAnthropicMessages(params.system, params.internalMessages);
  const tools = toAnthropicToolDefinitions(params.tools);
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxOutputTokens,
    system,
    messages,
    stream: true
  };
  if (tools.length) body.tools = tools;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`anthropic_http_${res.status}:${err.slice(0, 500)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('anthropic_no_response_body');
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const toolBlocks = new Map<
    number,
    { id?: string; name?: string; partialJson: string }
  >();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.replace(/^data:\s*/, '').trim();
      if (!payload || payload === '[DONE]') continue;
      let ev: {
        type?: string;
        index?: number;
        delta?: { type?: string; text?: string; partial_json?: string };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        content_block?: { type?: string; id?: string; name?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      try {
        ev = JSON.parse(payload) as typeof ev;
      } catch {
        continue;
      }
      if (ev.type === 'message_delta') {
        const u = ev.usage ?? ev.message?.usage;
        if (u) {
          usage.inputTokens = u.input_tokens ?? usage.inputTokens;
          usage.outputTokens = u.output_tokens ?? usage.outputTokens;
        }
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text;
        params.onTextDelta?.(ev.delta.text);
      }
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        const idx = ev.index ?? 0;
        toolBlocks.set(idx, {
          id: ev.content_block.id,
          name: ev.content_block.name,
          partialJson: ''
        });
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
        const idx = ev.index ?? 0;
        const cur = toolBlocks.get(idx);
        if (cur) cur.partialJson += ev.delta.partial_json;
      }
    }
  }

  const toolInvocations = [...toolBlocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id ?? `toolu_${Math.random().toString(36).slice(2)}`,
      name: v.name ?? 'unknown',
      input: safeJsonParseObject(v.partialJson)
    }));

  return { text, toolInvocations, usage };
}
