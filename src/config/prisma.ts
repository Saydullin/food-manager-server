import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * A single shared PrismaClient instance for the whole process.
 *
 * In development with a file-watcher (tsx watch) the module can be re-evaluated
 * on reload; caching the client on globalThis avoids exhausting DB connections
 * by creating a new client on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
