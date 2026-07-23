import { prisma } from "@/server/db/client";

export type AuditFilters = {
  entityType?: string;
  actorId?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  take?: number;
  cursor?: string; // id do último item da página anterior
};

/** Lista o log de auditoria da conta (mais recente primeiro), escopado e paginado. */
export async function listAudit(accountId: string, f: AuditFilters) {
  const take = Math.min(f.take ?? 50, 100);
  const items = await prisma.auditLog.findMany({
    where: {
      accountId,
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.actorId ? { actorId: f.actorId } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  return { items: hasMore ? items.slice(0, take) : items, nextCursor: hasMore ? items[take - 1].id : null };
}

/**
 * Poda por retenção: apaga linhas de auditoria mais velhas que `retentionDays`.
 * `retentionDays <= 0` = no-op (nunca poda). Roda no worker (uma vez/dia). Devolve
 * quantas foram apagadas (AuditLog + AiCallLog, mesma janela). Passa `now` p/ ser
 * determinístico/testável.
 */
export async function pruneAuditLogs(retentionDays: number, now: Date = new Date()): Promise<number> {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  // AiCallLog segue a MESMA retenção da AuditLog: ambos são logs append-only de
  // observabilidade que não devem crescer para sempre (dúvida/briga/custo aparece
  // no mês vigente + folga).
  const [audit, aiCalls] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.aiCallLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return audit.count + aiCalls.count;
}
