import { prisma } from "@/server/db/client";
import type { WhatsAppNumberStatus } from "@prisma/client";
import { sentTodayByNumber } from "@/server/worker/dispatcher";

export interface WhatsAppNumberListItem {
  id: string;
  label: string;
  phone: string;
  status: string;
  dailyCap: number;
  sentToday: number;
  pairingQr: string | null; // QR cru p/ pareamento (a UI converte em imagem)
}

/**
 * Lista os chips Baileys com o total enviado hoje (reusa `sentTodayByNumber`
 * p/ não duplicar a contagem por número). Vazio nos modos mock/cloud-api.
 */
export async function listWhatsAppNumbers(
  userId: string,
): Promise<WhatsAppNumberListItem[]> {
  const [numbers, counts] = await Promise.all([
    prisma.whatsAppNumber.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        label: true,
        phone: true,
        status: true,
        dailyCap: true,
        pairingQr: true,
      },
    }),
    sentTodayByNumber(new Date()),
  ]);
  return numbers.map((n) => ({ ...n, sentToday: counts[n.id] ?? 0 }));
}

// Status que o operador pode setar manualmente pela UI (sem mexer no pareamento).
const MANUAL_STATUSES = new Set<WhatsAppNumberStatus>(["CONNECTED", "PAUSED", "DISABLED"]);

/**
 * Edita um chip: apelido, cap diário e/ou status operacional. O status é
 * limitado a transições manuais seguras (pausar/reativar/desativar) — pareamento
 * e ban continuam a cargo do worker.
 */
export async function updateWhatsAppNumber(
  id: string,
  userId: string,
  data: { label?: string; dailyCap?: number; status?: WhatsAppNumberStatus },
): Promise<void> {
  const exists = await prisma.whatsAppNumber.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Número não encontrado");
  if (data.status !== undefined && !MANUAL_STATUSES.has(data.status)) {
    throw new Error("Status não permitido por aqui (use pausar/reativar/desativar).");
  }
  await prisma.whatsAppNumber.update({
    where: { id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.dailyCap !== undefined ? { dailyCap: data.dailyCap } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });
}

/** Remove um chip do CRM. Jobs/mensagens/leads ligados ficam órfãos (SetNull). */
export async function deleteWhatsAppNumber(id: string, userId: string): Promise<void> {
  const exists = await prisma.whatsAppNumber.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Número não encontrado");
  await prisma.whatsAppNumber.delete({ where: { id } });
}
