import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { dispatchOutboundJob } from "@/server/services/messaging";
import { selectNumber } from "@/server/whatsapp/baileys/selection";
import { decideNoChipAction } from "./nochip";

/** Conta quantos jobs já foram enviados hoje (cap diário / warm-up). */
export async function sentToday(now: Date): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.outboundJob.count({
    where: { status: "SENT", sentAt: { gte: start } },
  });
}

/** Quantos jobs uma CONTA já enviou hoje (cap diário por conta). */
export async function sentTodayByUser(userId: string, now: Date): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.outboundJob.count({
    where: { status: "SENT", sentAt: { gte: start }, lead: { is: { userId } } },
  });
}

/** Decide se a conta pode enviar agora. cap<=0 = ilimitado (modo massa). */
export function underAccountCap(sentToday: number, cap: number): boolean {
  return cap <= 0 || sentToday < cap;
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
 * Seleciona o chip (Baileys) menos carregado DA CONTA dona do job. Retorna o
 * id do número, ou null se a conta não tem nenhum chip elegível agora.
 */
async function pickNumberForUser(
  userId: string,
  now: Date,
): Promise<string | null> {
  const [counts, nums] = await Promise.all([
    sentTodayByNumber(now),
    prisma.whatsAppNumber.findMany({
      where: { userId },
      select: { id: true, status: true, dailyCap: true },
    }),
  ]);
  const chosen = selectNumber(
    nums.map((n) => ({
      id: n.id,
      status: n.status,
      dailyCap: n.dailyCap,
      sentToday: counts[n.id] ?? 0,
    })),
  );
  return chosen?.id ?? null;
}

/**
 * Reserva atomicamente 1 job PENDING da CONTA (lead.userId), respeitando
 * pausa/cap de campanha e janela. Retorna o id travado (SENDING) ou null.
 * Reusa cappedCampaignIds. Pensado p/ ser chamado por VÁRIOS chips em paralelo.
 */
export async function claimNextJobForAccount(userId: string, now: Date): Promise<string | null> {
  const [capCampaigns, sentByCampaign] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId, dailyCap: { not: null } },
      select: { id: true, dailyCap: true },
    }),
    sentTodayByCampaign(now),
  ]);
  const capped = cappedCampaignIds(capCampaigns, sentByCampaign);

  const candidate = await prisma.outboundJob.findFirst({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      // billingActive: conta suspensa não dispara (job fica PENDING, volta a
      // fluir sozinho ao reativar).
      lead: { is: { userId, user: { is: { billingActive: true } } } },
      OR: [
        { campaignId: null },
        {
          campaign: { status: { not: "PAUSED" } },
          ...(capped.length ? { campaignId: { notIn: capped } } : {}),
        },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claim = await prisma.outboundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 }, claimedAt: now },
  });
  return claim.count === 1 ? candidate.id : null;
}

/**
 * Reserva atomicamente 1 job PENDING (status → SENDING via updateMany com guarda)
 * de uma campanha que NÃO esteja pausada, e o processa. Retorna true se enviou.
 *
 * Multi-conta: no modo Baileys o chip de envio é escolhido entre os números DA
 * CONTA dona do job (job → lead → userId). Se a conta não tem chip elegível, o
 * job volta para a fila (sem contar tentativa) e seguimos para o próximo poll.
 */
export async function processNextJob(now: Date): Promise<boolean> {
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
      // billingActive: conta suspensa não dispara (job fica PENDING, volta a
      // fluir sozinho ao reativar).
      lead: { is: { user: { is: { billingActive: true } } } },
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
    select: { id: true, lead: { select: { userId: true } } },
  });
  if (!candidate) return false;

  // Lock otimista: só "ganha" o job quem conseguir mudar PENDING→SENDING.
  const claim = await prisma.outboundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 }, claimedAt: now },
  });
  if (claim.count === 0) return false; // outro worker pegou

  // Baileys: escolhe um chip da conta dona do job.
  let numberId: string | undefined;
  if (env.WHATSAPP_MODE === "baileys") {
    const picked = await pickNumberForUser(candidate.lead.userId, now);
    if (!picked) {
      const job = await prisma.outboundJob.findUnique({
        where: { id: candidate.id },
        select: { deferCount: true, campaignId: true },
      });
      const decision = decideNoChipAction((job?.deferCount ?? 0) + 1, env.WORKER_MAX_DEFERS);
      if (decision.action === "pause_campaign" && job?.campaignId) {
        await prisma.$transaction([
          prisma.campaign.update({ where: { id: job.campaignId }, data: { status: "PAUSED" } }),
          prisma.outboundJob.update({
            where: { id: candidate.id },
            data: {
              status: "PENDING",
              attempts: { decrement: 1 },
              claimedAt: null,
              lastError: "sem chip vivo — campanha pausada p/ reposição",
            },
          }),
        ]);
      } else {
        await prisma.outboundJob.update({
          where: { id: candidate.id },
          data: {
            status: "PENDING",
            attempts: { decrement: 1 },
            claimedAt: null,
            deferCount: { increment: 1 },
            scheduledFor: new Date(now.getTime() + 30_000),
          },
        });
      }
      return false;
    }
    numberId = picked;
  }

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
