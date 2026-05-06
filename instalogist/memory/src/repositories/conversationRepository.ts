import type { Conversation, MemorySource, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type CreateConversationInput = {
  agentId: string;
  title?: string | null;
  relatedTaskId?: string | null;
  relatedIncidentId?: string | null;
  channel?: string | null;
  source: MemorySource;
  sourceRef?: string | null;
  payload?: Prisma.InputJsonValue | null;
};

export async function createConversation(db: PrismaClient, input: CreateConversationInput): Promise<Conversation> {
  return db.conversation.create({
    data: {
      agentId: input.agentId,
      title: input.title ?? null,
      relatedTaskId: input.relatedTaskId ?? null,
      relatedIncidentId: input.relatedIncidentId ?? null,
      channel: input.channel ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      payload: input.payload ?? undefined
    }
  });
}

/** Terminal state: sets endedAt once (safe default: only if currently null). */
export async function closeConversation(db: PrismaClient, id: string, endedAt = new Date()): Promise<Conversation> {
  const existing = await db.conversation.findUnique({ where: { id } });
  if (!existing) throw new Error(`Conversation not found: ${id}`);
  if (existing.endedAt != null) return existing;
  return db.conversation.update({
    where: { id },
    data: { endedAt }
  });
}

export async function listOpenConversations(db: PrismaClient, take = 100): Promise<Conversation[]> {
  return db.conversation.findMany({
    where: { endedAt: null },
    orderBy: { startedAt: 'desc' },
    take
  });
}
