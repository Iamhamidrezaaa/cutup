/**
 * Seed default Instalogist agents and sample memory rows (dev / empty DB).
 */
import { PrismaClient } from '@prisma/client';
import {
  appendDecision,
  appendOperationalSummary,
  createConversation,
  createEscalation,
  recordDeploymentEvent,
  upsertIncident,
  upsertTask
} from '../src/repositories/index.js';

const prisma = new PrismaClient();

const DEFAULT_AGENTS = [
  { code: 'Dev-01', displayName: 'Dev-01', role: 'engineering' },
  { code: 'Ops-01', displayName: 'Ops-01', role: 'operations' },
  { code: 'Audit-01', displayName: 'Audit-01', role: 'audit' },
  { code: 'Growth-01', displayName: 'Growth-01', role: 'growth' },
  { code: 'Support-01', displayName: 'Support-01', role: 'support' }
] as const;

async function main(): Promise<void> {
  for (const a of DEFAULT_AGENTS) {
    await prisma.agent.upsert({
      where: { code: a.code },
      create: {
        code: a.code,
        displayName: a.displayName,
        role: a.role,
        source: 'seed',
        sourceRef: 'prisma/seed.ts'
      },
      update: {
        displayName: a.displayName,
        role: a.role
      }
    });
  }

  const dev = await prisma.agent.findUniqueOrThrow({ where: { code: 'Dev-01' } });
  const audit = await prisma.agent.findUniqueOrThrow({ where: { code: 'Audit-01' } });
  const ops = await prisma.agent.findUniqueOrThrow({ where: { code: 'Ops-01' } });

  const task = await upsertTask(prisma, {
    externalKey: 'SEED-TASK-00001',
    title: '[seed] Example operational task',
    status: 'triaged',
    priority: 'P2',
    riskClass: 'M',
    workspacePath: 'workspace/active/tasks/SEED-TASK-00001.md',
    ownerAgentId: dev.id,
    source: 'seed',
    sourceRef: 'prisma/seed.ts',
    payload: { seeded: true }
  });

  await upsertIncident(prisma, {
    externalKey: 'SEED-INC-00001',
    title: '[seed] Example incident',
    status: 'active',
    priority: 'P1',
    ownerAgentId: audit.id,
    source: 'seed',
    sourceRef: 'prisma/seed.ts'
  });

  await appendDecision(prisma, {
    title: 'Seed decision — no production effect',
    body: 'This row demonstrates append-only decision memory. Replace with real human-approved decisions in production.',
    decidedBy: 'human:seed',
    taskId: task.id,
    source: 'seed',
    sourceRef: 'prisma/seed.ts',
    metadata: { kind: 'example' }
  });

  await createConversation(prisma, {
    agentId: dev.id,
    title: 'Seed conversation shell',
    relatedTaskId: task.id,
    channel: 'internal',
    source: 'seed',
    sourceRef: 'prisma/seed.ts'
  });

  await createEscalation(prisma, {
    fromAgentId: ops.id,
    toAgentId: audit.id,
    reasonCode: 'deploy_failure',
    taskId: task.id,
    source: 'seed',
    sourceRef: 'prisma/seed.ts',
    metadata: { example: true }
  });

  await recordDeploymentEvent(prisma, {
    environment: 'staging',
    serviceName: 'cutup-api',
    version: '0.0.0-seed',
    gitSha: '0000000',
    status: 'success',
    source: 'seed',
    sourceRef: 'prisma/seed.ts'
  });

  const genAt = new Date().toISOString();
  await appendOperationalSummary(prisma, {
    snapshotKey: `seed:instalogist-operational-state-1:${genAt}`,
    contractId: 'instalogist-operational-state-1',
    parserVersion: '0.0.0-seed',
    snapshotStatus: 'ok',
    itemsCount: 1,
    source: 'seed',
    sourceRef: 'prisma/seed.ts',
    sourceGeneratedAt: new Date(genAt),
    summary: {
      seeded: true,
      note: 'Replace with parser snapshot JSON or summary projection.',
      generated_at: genAt
    }
  });

  // eslint-disable-next-line no-console -- seed CLI
  console.log('Instalogist memory seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
