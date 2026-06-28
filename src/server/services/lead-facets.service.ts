import { prisma } from "@/server/db/client";
import { cached } from "@/server/cache/cache";
import { cacheKeys } from "@/server/cache/keys";

export interface LeadFacets {
  byStatus: Record<string, number>;
  campaigns: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  total: number;
}

/**
 * Facetas do funil para o dashboard: contagem por status + catálogos de
 * campanhas e tags. Fonte própria (agregações baratas no banco) porque, com a
 * lista paginada, esses dados não podem mais ser derivados da lista inteira no
 * cliente. Escopo: conta do usuário (e opcionalmente o operador atribuído).
 */
export async function getLeadFacets(userId: string, assignedToId?: string): Promise<LeadFacets> {
  // Cache 60s: facetas alimentam selects/cards do dashboard e mudam pouco; a
  // invalidação nas escritas (invalidateLeadCaches) garante atualização rápida.
  return cached(cacheKeys.leadFacets(userId, assignedToId), 60, () =>
    computeLeadFacets(userId, assignedToId),
  );
}

async function computeLeadFacets(userId: string, assignedToId?: string): Promise<LeadFacets> {
  const where = { userId, ...(assignedToId ? { assignedToId } : {}) };
  const [grouped, campaigns, tags] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.campaign.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.tag.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }
  return { byStatus, campaigns, tags, total };
}
