import { prisma } from "@/server/db/client";
import type { FulfillmentStatus, OrderType } from "@prisma/client";
import { orderTotalCents } from "./order.service";

// Payload PÚBLICO de acompanhamento do pedido (sem login). Só o necessário para
// o cliente acompanhar o status + pagar o Pix enquanto não confirmado. Nunca
// vaza dados internos (comissões, lead, estoque, etc.).
export interface PublicOrderTracking {
  id: string;
  number: number | null;
  onlineNumber: number | null;
  fulfillmentStatus: FulfillmentStatus | null;
  orderType: OrderType | null;
  customerName: string | null;
  totalCents: number;
  paidOnline: boolean;
  // Pix copia-e-cola só enquanto o pagamento online NÃO foi confirmado. Depois
  // de pago, não há motivo para expor — evita reenvio/confusão.
  pixCopiaECola: string | null;
  createdAt: string;
  note: string | null;
}

/**
 * Acompanhamento público de um pedido online. Escopado por conta (accountId) +
 * source=ONLINE: nunca vaza comanda de outra conta ou de outra origem (POS).
 * Retorna null se não achar (a rota devolve 404 idêntico ao de conta inválida).
 */
export async function getPublicOrderTracking(
  accountId: string,
  orderId: string,
): Promise<PublicOrderTracking | null> {
  const o = await prisma.order.findFirst({
    where: { id: orderId, accountId, source: "ONLINE" },
    select: {
      id: true,
      number: true,
      onlineNumber: true,
      fulfillmentStatus: true,
      orderType: true,
      customerName: true,
      customerPhone: true,
      onlinePaidAt: true,
      onlinePixCopiaECola: true,
      onlineChargeProvider: true,
      createdAt: true,
      note: true,
      discountCents: true,
      surchargeCents: true,
      tipCents: true,
      deliveryFeeCents: true,
      lead: { select: { name: true } },
      items: { select: { unitPriceCents: true, quantity: true } },
    },
  });
  if (!o) return null;

  const totalCents = orderTotalCents({
    items: o.items.map((i) => ({ unitPriceCents: i.unitPriceCents, quantity: i.quantity })),
    discountCents: o.discountCents,
    surchargeCents: o.surchargeCents,
    tipCents: o.tipCents,
    deliveryFeeCents: o.deliveryFeeCents,
  });

  const paidOnline = !!o.onlinePaidAt;

  return {
    id: o.id,
    number: o.number,
    onlineNumber: o.onlineNumber,
    fulfillmentStatus: o.fulfillmentStatus,
    orderType: o.orderType,
    customerName: o.customerName ?? o.lead?.name ?? null,
    totalCents,
    paidOnline,
    // Só devolve o Pix se havia cobrança online e ainda não foi paga.
    pixCopiaECola: !paidOnline && o.onlineChargeProvider ? o.onlinePixCopiaECola : null,
    createdAt: o.createdAt.toISOString(),
    note: o.note,
  };
}
