import { prisma } from "@/server/db/client";
import { dispatchOutboundJob } from "@/server/services/messaging";

/** Conta quantos jobs já foram enviados hoje (cap diário / warm-up). */
export async function sentToday(now: Date): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.outboundJob.count({
    where: { status: "SENT", sentAt: { gte: start } },
  });
}

/** Quantos jobs cada número já enviou hoje (p/ cap por chip — Baileys). */
export async function sentTodayByNumber(now: Date): Promise<Record<string, number>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.outboundJob.groupBy({
    by: ["whatsAppNumberId"],
    where: { status: "SENT", sentAt: { gte: start }, whatsAppNumberId: { not: null } },
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) if (r.whatsAppNumberId) map[r.whatsAppNumberId] = r._count._all;
  return map;
}

/** Quantos jobs cada campanha já enviou hoje (p/ cap diário por campanha). */
export async function sentTodayByCampaign(now: Date): Promise<Record<string, number>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.outboundJob.groupBy({
    by: ["campaignId"],
    where: { status: "SENT", sentAt: { gte: start }, campaignId: { not: null } },
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) if (r.campaignId) map[r.campaignId] = r._count._all;
  return map;
}

/**
 * Lógica pura: dado o cap de cada campanha e o total já enviado hoje, devolve os
 * ids das campanhas que JÁ atingiram o próprio teto diário (saem do disparo no
 * dia). `dailyCap` null = campanha sem teto próprio (vale só o cap global).
 */
export function cappedCampaignIds(
  campaigns: { id: string; dailyCap: number | null }[],
  sentByCampaign: Record<string, number>,
): string[] {
  return campaigns
    .filter((c) => c.dailyCap != null && (sentByCampaign[c.id] ?? 0) >= c.dailyCap)
    .map((c) => c.id);
}

/**
 * Reserva atomicamente 1 job PENDING (status → SENDING via updateMany com guarda)
 * de uma campanha que NÃO esteja pausada, e o processa. Retorna true se enviou.
 */
export async function processNextJob(now: Date, numberId?: string): Promise<boolean> {
  // Campanhas que já bateram o próprio cap diário ficam de fora da seleção de hoje.
  const [capCampaigns, sentByCampaign] = await Promise.all([
    prisma.campaign.findMany({
      where: { dailyCap: { not: null } },
      select: { id: true, dailyCap: true },
    }),
    sentTodayByCampaign(now),
  ]);
  const capped = cappedCampaignIds(capCampaigns, sentByCampaign);

  const candidate = await prisma.outboundJob.findFirst({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      OR: [
        { campaignId: null },
        {
          campaign: { status: { not: "PAUSED" } },
          // exclui jobs de campanhas no teto diário (notIn vazio = sem exclusão)
          ...(capped.length > 0 ? { campaignId: { notIn: capped } } : {}),
        },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    select: { id: true },
  });
  if (!candidate) return false;

  // Lock otimista: só "ganha" o job quem conseguir mudar PENDING→SENDING.
  const claim = await prisma.outboundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claim.count === 0) return false; // outro worker pegou

  try {
    await dispatchOutboundJob(candidate.id, { numberId });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const job = await prisma.outboundJob.findUnique({
      where: { id: candidate.id },
      select: { attempts: true },
    });
    const failed = (job?.attempts ?? 99) >= 3;
    await prisma.outboundJob.update({
      where: { id: candidate.id },
      data: failed
        ? { status: "FAILED", lastError: msg }
        : { status: "PENDING", lastError: msg, scheduledFor: new Date(now.getTime() + 60_000) },
    });
    return false;
  }
}
