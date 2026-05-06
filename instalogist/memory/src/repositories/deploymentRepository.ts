import type { DeploymentEvent, DeploymentEventStatus, MemorySource, Prisma } from '@prisma/client';
import type { PrismaClient } from '../db.js';

export type RecordDeploymentEventInput = {
  environment: string;
  serviceName?: string | null;
  version?: string | null;
  gitSha?: string | null;
  status: DeploymentEventStatus;
  source: MemorySource;
  sourceRef?: string | null;
  payload?: Prisma.InputJsonValue | null;
};

/** Append-only deployment fact. */
export async function recordDeploymentEvent(db: PrismaClient, input: RecordDeploymentEventInput): Promise<DeploymentEvent> {
  return db.deploymentEvent.create({
    data: {
      environment: input.environment,
      serviceName: input.serviceName ?? null,
      version: input.version ?? null,
      gitSha: input.gitSha ?? null,
      status: input.status,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      payload: input.payload ?? undefined
    }
  });
}

export async function listRecentDeployments(db: PrismaClient, take = 50): Promise<DeploymentEvent[]> {
  return db.deploymentEvent.findMany({
    orderBy: { generatedAt: 'desc' },
    take
  });
}
