import type { Decision, MemorySource, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type CreateDecisionInput = {
  title: string;
  body: string;
  decidedBy: string;
  taskId?: string | null;
  incidentId?: string | null;
  supersedesId?: string | null;
  source: MemorySource;
  sourceRef?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

/**
 * Append-only: creates a new decision row. Corrections use `supersedesId` chain.
 */
export async function appendDecision(db: PrismaClient, input: CreateDecisionInput): Promise<Decision> {
  return db.decision.create({
    data: {
      title: input.title,
      body: input.body,
      decidedBy: input.decidedBy,
      taskId: input.taskId ?? null,
      incidentId: input.incidentId ?? null,
      supersedesId: input.supersedesId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      metadata: input.metadata ?? undefined
    }
  });
}

export async function listDecisionsForTask(db: PrismaClient, taskId: string, take = 50): Promise<Decision[]> {
  return db.decision.findMany({
    where: { taskId },
    orderBy: { generatedAt: 'desc' },
    take
  });
}

export async function listRecentDecisions(db: PrismaClient, take = 50): Promise<Decision[]> {
  return db.decision.findMany({
    orderBy: { generatedAt: 'desc' },
    take
  });
}
