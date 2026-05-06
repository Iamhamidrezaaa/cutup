/** Conversation turns shared by providers (no infinite history growth — executor may trim). */
export type InternalMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text?: string;
      toolInvocations?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    }
  | { role: 'tool'; toolCallId: string; name: string; resultJson: string };
