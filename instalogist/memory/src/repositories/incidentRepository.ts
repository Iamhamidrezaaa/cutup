import type { Incident, MemorySource, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type IncidentUpsertInput = {
  externalKey: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  workspacePath?: string | null;
  ownerAgentId?: string | null;
  source: MemorySource;
  sourceRef?: string | null;
  sourceGeneratedAt?: Date | null;
  payload?: Prisma.InputJsonValue | null;
};

export async function upsertIncident(db: PrismaClient, input: IncidentUpsertInput): Promise<Incident> {
  return db.incident.upsert({
    where: {
      source_externalKey: { source: input.source, externalKey: input.externalKey }
    },
    create: {
      externalKey: input.externalKey,
      title: input.title,
      status: input.status ?? null,
      priority: input.priority ?? null,
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
      workspacePath: input.workspacePath ?? null,
      ownerAgentId: input.ownerAgentId ?? null,
      sourceRef: input.sourceRef ?? null,
      sourceGeneratedAt: input.sourceGeneratedAt ?? null,
      payload: input.payload ?? undefined
    }
  });
}

export async function findIncidentByExternalKey(
  db: PrismaClient,
  source: MemorySource,
  externalKey: string
): Promise<Incident | null> {
  return db.incident.findUnique({
    where: { source_externalKey: { source, externalKey } }
  });
}

export async function listRecentIncidents(db: PrismaClient, take = 100): Promise<Incident[]> {
  return db.incident.findMany({
    orderBy: { generatedAt: 'desc' },
    take,
    include: { owner: true }
  });
}
