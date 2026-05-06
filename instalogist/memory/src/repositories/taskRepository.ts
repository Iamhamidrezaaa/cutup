import type { MemorySource, Prisma, Task } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type TaskUpsertInput = {
  externalKey: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  riskClass?: string | null;
  workspacePath?: string | null;
  ownerAgentId?: string | null;
  source: MemorySource;
  sourceRef?: string | null;
  sourceGeneratedAt?: Date | null;
  payload?: Prisma.InputJsonValue | null;
};

/**
 * Idempotent materialization of task memory from ingestion (workspace / parser).
 */
export async function upsertTask(db: PrismaClient, input: TaskUpsertInput): Promise<Task> {
  return db.task.upsert({
    where: {
      source_externalKey: { source: input.source, externalKey: input.externalKey }
    },
    create: {
      externalKey: input.externalKey,
      title: input.title,
      status: input.status ?? null,
      priority: input.priority ?? null,
      riskClass: input.riskClass ?? null,
      workspacePath: input.workspacePath ?? null,
      ownerAgentId: input.ownerAgentId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      sourceGeneratedAt: input.sourceGeneratedAt ?? null,
      payload: input.payload ?? undefined
    },
    update: {
      title: input.title,
      status: input.status ?? null,
      priority: input.priority ?? null,
      riskClass: input.riskClass ?? null,
      workspacePath: input.workspacePath ?? null,
      ownerAgentId: input.ownerAgentId ?? null,
      sourceRef: input.sourceRef ?? null,
      sourceGeneratedAt: input.sourceGeneratedAt ?? null,
      payload: input.payload ?? undefined
    }
  });
}

export async function findTaskByExternalKey(
  db: PrismaClient,
  source: MemorySource,
  externalKey: string
): Promise<Task | null> {
  return db.task.findUnique({
    where: { source_externalKey: { source, externalKey } }
  });
}

export async function listRecentTasks(db: PrismaClient, take = 100): Promise<Task[]> {
  return db.task.findMany({
    orderBy: { generatedAt: 'desc' },
    take,
    include: { owner: true }
  });
}
