import type { Agent, MemorySource, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export async function createAgent(
  db: PrismaClient,
  data: {
    code: string;
    displayName?: string | null;
    role?: string | null;
    metadata?: Prisma.InputJsonValue | null;
    source?: MemorySource;
    sourceRef?: string | null;
  }
): Promise<Agent> {
  return db.agent.create({
    data: {
      code: data.code,
      displayName: data.displayName ?? null,
      role: data.role ?? null,
      metadata: data.metadata ?? undefined,
      source: data.source ?? 'system',
      sourceRef: data.sourceRef ?? null
    }
  });
}

export async function findAgentByCode(db: PrismaClient, code: string): Promise<Agent | null> {
  return db.agent.findUnique({ where: { code } });
}

export async function listAgents(db: PrismaClient, take = 200): Promise<Agent[]> {
  return db.agent.findMany({
    orderBy: { code: 'asc' },
    take
  });
}
