import { prisma } from "@/server/db/client";
import { formatCentsBRL } from "@/lib/money";
import { orderTotalCents } from "./order.service";
import { logger } from "@/lib/logger";

const loadPool = () => import("@/server/whatsapp/baileys/pool");

/**
 * Avisa o lojista (no próprio WhatsApp) que entrou um novo pedido online.
 * Best-effort: não bloqueia o fluxo se falhar (sem chip conectado, sem número do
 * dono, erro de envio) — a fila da UI (polling) é o fallback visível.
 *
 * Não persiste uma Message (sendWhatsAppMessage exige um lead; o dono não é um
 * lead). Envia direto pelo pool Baileys para o `User.whatsapp`.
 */
export async function notifyMerchantNewOnlineOrder(accountId: string, orderId: string): Promise<void> {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: accountId },
      select: { whatsapp: true },
    });
    if (!owner?.whatsapp) return; // dono não cadastrou o próprio telefone

    const order = await prisma.order.findFirst({
      where: { id: orderId, accountId },
      select: { number: true, orderType: true, fulfillmentStatus: true, customerPhone: true, onlinePaidAt: true, deliveryFeeCents: true, items: { select: { unitPriceCents: true, quantity: true } } },
    });
    if (!order) return;

    const total = orderTotalCents({ items: order.items, deliveryFeeCents: order.deliveryFeeCents });
    const doc = order.number != null ? `#${order.number}` : orderId.slice(0, 8);
    const tipo = order.orderType === "DELIVERY" ? "Entrega" : order.orderType === "RETIRADA" ? "Retirada" : "Pedido";
    const pago = order.onlinePaidAt ? " (Pago online)" : " (Pagar na entrega)";
    const text = `🛎️ Novo pedido online ${doc} — ${tipo}${pago}\nTotal: ${formatCentsBRL(total)}\nCliente: ${order.customerPhone ?? "—"}`;

    const pool = await loadPool();
    const chips = await prisma.whatsAppNumber.findMany({
      where: { userId: accountId, status: { in: ["CONNECTED", "WARMING"] } },
      select: { id: true },
    });
    const numberId = chips.find((c) => pool.hasLiveSocket(c.id))?.id ?? null;
    if (!numberId) return; // sem chip vivo → fica só na fila da UI

    await pool.send(numberId, owner.whatsapp, text);
  } catch (e) {
    logger.warn({ err: e, orderId }, "[delivery] notificação ao lojista falhou (não bloqueia)");
  }
}
