import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient(): PrismaClient {
  const log: Array<'query' | 'info' | 'warn' | 'error'> =
    process.env.NODE_ENV === 'development' && process.env.MEMORY_PRISMA_LOG === '1'
      ? ['query', 'warn', 'error']
      : ['error'];
  return new PrismaClient({ log });
}

/**
 * Shared Prisma client (singleton in dev to survive hot reload).
 */
export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export type { PrismaClient };
