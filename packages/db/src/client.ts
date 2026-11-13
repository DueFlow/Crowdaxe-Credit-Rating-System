import { PrismaClient } from '@prisma/client';

/** One Prisma client per process (serverless functions reuse it between requests). */
const g = globalThis as unknown as { __crsPrisma?: PrismaClient };

export function prisma(): PrismaClient {
  g.__crsPrisma ??= new PrismaClient();
  return g.__crsPrisma;
}

export { PrismaClient };
export type { Prisma } from '@prisma/client';
