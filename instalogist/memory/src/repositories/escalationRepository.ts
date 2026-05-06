import type { Escalation, EscalationStatus, MemorySource, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type CreateEscalationInput = {
  fromAgentId: string;
  toAgentId?: string | null;
  reasonCode: string;
  taskId?: string | null;
  incidentId?: string | null;
  source: MemorySource;
  sourceRef?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

export async function createEscalation(db: PrismaClient, input: CreateEscalationInput): Promise<Escalation> {
  return db.escalation.create({
    data: {
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId ?? null,
      reasonCode: input.reasonCode,
      taskId: input.taskId ?? null,
      incidentId: input.incidentId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      metadata: input.metadata ?? undefined
    }
  });
}

/** One-way lifecycle: pending/acknowledged → resolved with timestamp. */
export async function resolveEscalation(
  db: PrismaClient,
  id: string,
  status: Extract<EscalationStatus, 'resolved' | 'cancelled'> = 'resolved'
): Promise<Escalation> {
  return db.escalation.update({
    where: { id },
    data: {
      status,
      resolvedAt: new Date()
    }
  });
}

export async function acknowledgeEscalation(db: PrismaClient, id: string): Promise<Escalation> {
  return db.escalation.update({
    where: { id },
    data: { status: 'acknowledged' }
  });
}

export async function listPendingEscalations(db: PrismaClient, take = 100): Promise<Escalation[]> {
  return db.escalation.findMany({
    where: { status: { in: ['pending', 'acknowledged'] } },
    orderBy: { generatedAt: 'asc' },
    take,
    include: { fromAgent: true, toAgent: true, task: true, incident: true }
  });
}
