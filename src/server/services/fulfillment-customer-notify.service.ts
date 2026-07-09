import { prisma } from "@/server/db/client";
import { getDeliverySettings } from "./delivery-settings.service";
import { sendWhatsAppMessage } from "./messaging";
import { logger } from "@/lib/logger";
import type { FulfillmentStatus, OrderType } from "@prisma/client";

/**
 * Avisa o CLIENTE (no WhatsApp) sobre a mudança de status do seu pedido online.
 * Best-effort: nunca bloqueia a transição se o envio falhar (sem chip conectado,
 * lead sem telefone, erro de envio) — a página de acompanhamento é o fallback.
 *
 * Mensagens por transição:
 *  - CONFIRMADO: "✅ Pedido confirmado! Preparo ~<prepMin> min."
 *  - EM_PREPARO: "👨‍🍳 Em preparo."
 *  - PRONTO (retirada): "📦 Pronto para retirada!"; (delivery): "📦 Pronto."
 *  - SAIU_ENTREGA: "🛵 Saiu para entrega!"
 *  - ENTREGUE: "🎉 Entregue. Obrigado!"
 */
export async function notifyCustomerOrderStatus(
  accountId: string,
  orderId: string,
  status: FulfillmentStatus,
): Promise<void> {
  try {
    const order = await prisma.order.findFirst({
      where: { id: orderId, accountId, source: "ONLINE" },
      select: {
        number: true,
        orderType: true,
        lead: { select: { id: true, phone: true, userId: true, whatsAppNumberId: true } },
      },
    });
    if (!order?.lead || !order.lead.phone) return; // sem lead/telefone → só acompanha pela página

    const text = await buildMessage(accountId, status, order.orderType, order.number);
    if (!text) return; // status sem mensagem (ex.: PENDENTE)

    // sendWhatsAppMessage persiste a Message (source=SYSTEM) e envia pelo Baileys.
    await sendWhatsAppMessage(order.lead, text, { source: "SYSTEM" });
  } catch (e) {
    logger.warn({ err: e, orderId, status }, "[delivery] notificação ao cliente falhou (não bloqueia)");
  }
}

/** Monta a mensagem por status. Retorna null se não há o que avisar. */
async function buildMessage(
  accountId: string,
  status: FulfillmentStatus,
  orderType: OrderType | null,
  number: number | null,
): Promise<string | null> {
  const doc = number != null ? `#${number}` : "";
  const prefix = doc ? `Pedido ${doc} — ` : "";

  switch (status) {
    case "CONFIRMADO": {
      // prepMin enriquece a mensagem, mas não é crítico — se falhar, omite.
      let prep = "";
      try {
        const settings = await getDeliverySettings(accountId);
        if (settings.defaultPrepMinutes > 0) {
          prep = ` Preparo ~${settings.defaultPrepMinutes} min.`;
        }
      } catch {
        /* omite o tempo */
      }
      return `${prefix}✅ Pedido confirmado!${prep}`;
    }
    case "EM_PREPARO":
      return `${prefix}👨‍🍳 Seu pedido já está em preparo.`;
    case "PRONTO":
      return orderType === "RETIRADA"
        ? `${prefix}📦 Pronto para retirada!`
        : `${prefix}📦 Seu pedido está pronto.`;
    case "SAIU_ENTREGA":
      return `${prefix}🛵 Saiu para entrega!`;
    case "ENTREGUE":
      return `${prefix}🎉 Pedido entregue. Obrigado!`;
    default:
      // PENDENTE/RECUSADO não disparam mensagem ao cliente aqui.
      return null;
  }
}
