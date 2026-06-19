import { prisma } from "@/server/db/client";

/** ETA em minutos = fila / vazão por minuto. Vazão 0 (sem chip vivo) → null. */
export function estimateEtaMinutes(pending: number, sentPerMinute: number): number | null {
  if (sentPerMinute <= 0) return null;
  return Math.ceil(pending / sentPerMinute);
}

export interface CampaignProgress {
  pending: number; // PENDING + SENDING (ainda na fila)
  sent: number;
  failed: number;
  liveChips: number;
  sentPerMinute: number;
  etaMinutes: number | null;
}

/**
 * Progresso de uma campanha: contagens por status, chips vivos da conta dona,
 * vazão recente (SENT na última hora / 60) e ETA. Verifica posse via userId.
 * Retorna null se a campanha não pertence ao usuário.
 */
export async function getCampaignProgress(
  campaignId: string,
  userId: string,
  now: Date,
): Promise<CampaignProgress | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    select: { id: true },
  });
  if (!campaign) return null;

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [byStatus, sentLastHour, liveChips] = await Promise.all([
    prisma.outboundJob.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.outboundJob.count({
      where: { campaignId, status: "SENT", sentAt: { gte: hourAgo } },
    }),
    prisma.whatsAppNumber.count({
      where: { userId, status: { in: ["CONNECTED", "WARMING"] } },
    }),
  ]);

  let pending = 0;
  let sent = 0;
  let failed = 0;
  for (const r of byStatus) {
    const n = r._count._all;
    if (r.status === "PENDING" || r.status === "SENDING") pending += n;
    else if (r.status === "SENT") sent += n;
    else if (r.status === "FAILED") failed += n;
  }

  const sentPerMinute = sentLastHour / 60;
  return {
    pending,
    sent,
    failed,
    liveChips,
    sentPerMinute,
    etaMinutes: estimateEtaMinutes(pending, sentPerMinute),
  };
}
