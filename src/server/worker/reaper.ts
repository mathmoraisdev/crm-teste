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
