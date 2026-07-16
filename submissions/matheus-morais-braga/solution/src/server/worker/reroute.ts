import { prisma } from "@/server/db/client";

/** Status de jobs que ainda podem ser reenviados (não SENT/FAILED/CANCELLED). */
export const REROUTABLE = ["PENDING", "SENDING"] as const;

/**
 * Libera os jobs presos a um chip que saiu de operação (ban/queda fatal):
 * volta a PENDING, zera chip e lease. Outro chip vivo reprocessa. Retorna a
 * contagem reroteada.
 */
export async function rerouteJobsFromNumber(numberId: string, now: Date): Promise<number> {
  const { count } = await prisma.outboundJob.updateMany({
    where: { whatsAppNumberId: numberId, status: { in: [...REROUTABLE] } },
    data: { status: "PENDING", whatsAppNumberId: null, claimedAt: null, scheduledFor: now },
  });
  return count;
}
