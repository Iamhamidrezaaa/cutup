import type { MemorySource, OperationalSummary, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type AppendOperationalSummaryInput = {
  snapshotKey: string;
  summary: Prisma.InputJsonValue;
  contractId?: string | null;
  parserVersion?: string | null;
  snapshotStatus?: string | null;
  itemsCount?: number | null;
  source: MemorySource;
  sourceRef?: string | null;
  sourceGeneratedAt?: Date | null;
};

/**
 * Append-only snapshot row. Use a unique `snapshotKey` per ingest (e.g. `${contract}:${generatedAt}:${hash}`).
 */
export async function appendOperationalSummary(
  db: PrismaClient,
  input: AppendOperationalSummaryInput
): Promise<OperationalSummary> {
  return db.operationalSummary.create({
    data: {
      snapshotKey: input.snapshotKey,
      summary: input.summary,
      contractId: input.contractId ?? null,
      parserVersion: input.parserVersion ?? null,
      snapshotStatus: input.snapshotStatus ?? null,
      itemsCount: input.itemsCount ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      sourceGeneratedAt: input.sourceGeneratedAt ?? null
    }
  });
}

export async function getLatestOperationalSummary(db: PrismaClient): Promise<OperationalSummary | null> {
  return db.operationalSummary.findFirst({
    orderBy: { generatedAt: 'desc' }
  });
}

export async function listRecentOperationalSummaries(db: PrismaClient, take = 20): Promise<OperationalSummary[]> {
  return db.operationalSummary.findMany({
    orderBy: { generatedAt: 'desc' },
    take
  });
}
