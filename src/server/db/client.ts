import { PrismaClient } from "@prisma/client";

/**
 * Singleton do PrismaClient.
 *
 * Em dev o Next faz hot-reload e recriaria várias conexões; guardamos a
 * instância no globalThis para reaproveitar. Em produção é uma instância única.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Pool: configurado via `?connection_limit=N&pool_timeout=N` na DATABASE_URL
// (NÃO existe opção de pool no construtor do Prisma). Ver .env.example.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
