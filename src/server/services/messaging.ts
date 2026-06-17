import { prisma } from "@/server/db/client";
import { getWhatsApp } from "@/server/whatsapp";

/**
 * Envia uma mensagem via WhatsApp (mock ou real) e persiste como OUTBOUND.
 * Fonte única de verdade para envio — usada pela conversa e pelo agendamento,
 * evitando duplicar a lógica de persistência em cada lugar.
 */
export async function sendWhatsAppMessage(
  lead: { id: string; phone: string },
  text: string,
): Promise<void> {
  const wa = getWhatsApp();
  const { providerMessageId } = await wa.sendMessage(lead.phone, text);
  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "OUTBOUND",
      content: text,
      providerMessageId,
      status: "SENT",
    },
  });
  // Toca updatedAt do lead para o dashboard refletir atividade recente.
  await prisma.lead.update({
    where: { id: lead.id },
    data: { updatedAt: new Date() },
  });
}
