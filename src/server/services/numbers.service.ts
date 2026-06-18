import { prisma } from "@/server/db/client";
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
export async function listWhatsAppNumbers(): Promise<WhatsAppNumberListItem[]> {
  const [numbers, counts] = await Promise.all([
    prisma.whatsAppNumber.findMany({
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
