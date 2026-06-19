import { prisma } from "@/server/db/client";

export interface ReclaimableJob {
  status: string;
  claimedAt: Date | null;
}

/**
 * Um job em SENDING é "órfão" quando o lease venceu — o worker que o travou
 * provavelmente morreu (deploy/crash) entre o claim e o envio. claimedAt null
 * conta como recuperável (estado inconsistente herdado).
 */
export function isReclaimable(job: ReclaimableJob, now: Date, leaseMs: number): boolean {
  if (job.status !== "SENDING") return false;
  if (!job.claimedAt) return true;
  return now.getTime() - job.claimedAt.getTime() >= leaseMs;
}

/**
 * Devolve à fila todo job SENDING cujo lease venceu. Limpa claimedAt e o chip,
 * para que QUALQUER chip vivo possa reprocessar (não fica preso ao número morto).
 * Retorna quantos foram recuperados. Idempotente; seguro rodar com frequência.
 */
export async function reclaimStuckJobs(now: Date, leaseMs: number): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const { count } = await prisma.outboundJob.updateMany({
    where: {
      status: "SENDING",
      OR: [{ claimedAt: { lt: cutoff } }, { claimedAt: null }],
    },
    data: {
      status: "PENDING",
      claimedAt: null,
      whatsAppNumberId: null, // libera p/ rerotear em qualquer chip
      scheduledFor: now,
    },
  });
  return count;
}
