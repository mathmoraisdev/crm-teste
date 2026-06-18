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

/**
 * Reserva atomicamente 1 job PENDING (status → SENDING via updateMany com guarda)
 * de uma campanha que NÃO esteja pausada, e o processa. Retorna true se enviou.
 */
export async function processNextJob(now: Date, numberId?: string): Promise<boolean> {
  const candidate = await prisma.outboundJob.findFirst({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      OR: [{ campaignId: null }, { campaign: { status: { not: "PAUSED" } } }],
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
