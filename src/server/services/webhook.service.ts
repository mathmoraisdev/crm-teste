import { prisma } from "@/server/db/client";

const STATUS_MAP: Record<string, "DELIVERED" | "READ" | "FAILED" | "SENT"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/** Atualiza UMA mensagem pelo providerMessageId (usado por webhook E Baileys). */
export async function applyAck(
  providerMessageId: string,
  status: "DELIVERED" | "READ" | "FAILED" | "SENT",
): Promise<void> {
  await prisma.message.updateMany({
    where: { providerMessageId },
    data: { status },
  });
}

/** Atualiza Message.status a partir dos eventos `statuses` do Graph API. */
export async function applyStatuses(statuses: any[]): Promise<void> {
  for (const s of statuses ?? []) {
    const mapped = STATUS_MAP[s.status];
    if (!mapped || !s.id) continue;
    await applyAck(s.id, mapped);
  }
}

/**
 * Gate de qualidade: se a Meta sinaliza queda de qualidade do número
 * (event=FLAGGED/quality RED|YELLOW), pausa as campanhas RUNNING.
 */
export async function applyQualityUpdate(value: any): Promise<void> {
  const event = value?.event ?? value?.current_limit ?? value?.quality_rating;
  const degraded =
    value?.quality_rating === "RED" ||
    value?.quality_rating === "YELLOW" ||
    value?.event === "FLAGGED" ||
    value?.event === "DOWNGRADE";
  if (!degraded) return;
  const { count } = await prisma.campaign.updateMany({
    where: { status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  console.warn(`[webhook] qualidade degradada (${JSON.stringify(event)}) → ${count} campanha(s) pausada(s)`);
}
