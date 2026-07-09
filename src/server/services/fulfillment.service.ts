import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";
import type { FulfillmentStatus, OrderSource, OrderType } from "@prisma/client";
import { closeOrder, getKitchenOrder, orderTotalCents } from "./order.service";
import { buildKitchenTickets } from "@/lib/receipt/kitchen";
import type { KitchenTicket } from "@/lib/receipt/kitchen";
import { notifyMerchantNewOnlineOrder } from "./fulfillment-notify.service";

export type { KitchenTicket };

export interface OnlineOrderSummary {
  id: string;
  number: number | null;
  fulfillmentStatus: FulfillmentStatus | null;
  orderType: OrderType | null;
  source: OrderSource | null;
  customerName: string | null;
  customerPhone: string | null;
  totalCents: number;
  onlinePaidAt: string | null;
  createdAt: string;
  deliveryAddress: unknown;
}

const NEXT: Record<Exclude<FulfillmentStatus, "RECUSADO" | "ENTREGUE">, FulfillmentStatus> = {
  PENDENTE: "CONFIRMADO",
  CONFIRMADO: "EM_PREPARO",
  EM_PREPARO: "PRONTO",
  PRONTO: "SAIU_ENTREGA",
  SAIU_ENTREGA: "ENTREGUE",
};

function toSummary(o: {
  id: string;
  number: number | null;
  fulfillmentStatus: FulfillmentStatus | null;
  orderType: OrderType | null;
  source: OrderSource | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryFeeCents: number | null;
  discountCents: number | null;
  surchargeCents: number | null;
  tipCents: number | null;
  onlinePaidAt: Date | null;
  createdAt: Date;
  deliveryAddress: Prisma.JsonValue | null;
  lead: { name: string | null } | null;
  items: { unitPriceCents: number; quantity: number }[];
}): OnlineOrderSummary {
  const total = orderTotalCents({
    items: o.items.map((i) => ({ unitPriceCents: i.unitPriceCents, quantity: i.quantity })),
    discountCents: o.discountCents,
    surchargeCents: o.surchargeCents,
    tipCents: o.tipCents,
    deliveryFeeCents: o.deliveryFeeCents,
  });
  return {
    id: o.id,
    number: o.number,
    fulfillmentStatus: o.fulfillmentStatus,
    orderType: o.orderType,
    source: o.source,
    customerName: o.customerName ?? o.lead?.name ?? null,
    customerPhone: o.customerPhone,
    totalCents: total,
    onlinePaidAt: o.onlinePaidAt ? o.onlinePaidAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    deliveryAddress: o.deliveryAddress,
  };
}

/** Lista pedidos online (source=ONLINE) da conta, ordenados por criação desc. */
export async function listOnlineOrders(accountId: string, opts?: { status?: FulfillmentStatus }): Promise<OnlineOrderSummary[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, source: "ONLINE", ...(opts?.status ? { fulfillmentStatus: opts.status } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      items: { select: { unitPriceCents: true, quantity: true } },
      lead: { select: { name: true } },
    },
  });
  return orders.map(toSummary);
}

/** Resumo de um pedido online (tenant-safe). */
export async function getOnlineOrder(accountId: string, orderId: string): Promise<OnlineOrderSummary & { status: string }> {
  const o = await prisma.order.findFirst({
    where: { id: orderId, accountId, source: "ONLINE" },
    include: { items: { select: { unitPriceCents: true, quantity: true } }, lead: { select: { name: true } } },
  });
  if (!o) throw new Error("Pedido não encontrado.");
  return { ...toSummary(o), status: o.status };
}

async function loadOwnedOnline(accountId: string, orderId: string) {
  const o = await prisma.order.findFirst({
    where: { id: orderId, accountId, source: "ONLINE" },
    select: { id: true, fulfillmentStatus: true, status: true, onlinePaidAt: true, orderType: true, onlineChargeProvider: true },
  });
  if (!o) throw new Error("Pedido não encontrado.");
  return o;
}

/** PENDENTE → CONFIRMADO. Devolve os tickets de cozinha para impressão. */
export async function confirmOnlineOrder(
  accountId: string,
  orderId: string,
): Promise<{ fulfillmentStatus: FulfillmentStatus; tickets: KitchenTicket[] }> {
  const o = await loadOwnedOnline(accountId, orderId);
  if (o.fulfillmentStatus !== "PENDENTE") {
    throw new Error("Pedido já foi confirmado ou recusado.");
  }
  await prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "CONFIRMADO" } });
  const kitchen = await getKitchenOrder(accountId, orderId);
  const tickets = buildKitchenTickets(kitchen);
  return { fulfillmentStatus: "CONFIRMADO", tickets };
}

/** PENDENTE → RECUSADO. Comanda segue ABERTA (não baixa estoque). Se pago online, registra nota de estorno manual. */
export async function rejectOnlineOrder(
  accountId: string,
  orderId: string,
  reason: string,
): Promise<{ fulfillmentStatus: FulfillmentStatus }> {
  const o = await loadOwnedOnline(accountId, orderId);
  if (o.fulfillmentStatus !== "PENDENTE") {
    throw new Error("Pedido já foi confirmado ou recusado.");
  }
  const note = reason.trim() || "Pedido recusado pelo estabelecimento.";
  await prisma.order.update({
    where: { id: orderId },
    data: {
      fulfillmentStatus: "RECUSADO",
      note: o.onlinePaidAt ? `${note}\n[Atenção: pedido pago online — estornar manualmente]` : note,
    },
  });
  return { fulfillmentStatus: "RECUSADO" };
}

/**
 * Avança um passo na cadeia CONFIRMADO→EM_PREPARO→PRONTO→SAIU_ENTREGA→ENTREGUE.
 * Em ENTREGUE, fecha a comanda (closeOrder: baixa estoque + fiscal + relatórios)
 * com payment=PIX (pago online) ou DINHEIRO (na entrega).
 */
export async function advanceOnlineOrder(
  accountId: string,
  orderId: string,
): Promise<{ fulfillmentStatus: FulfillmentStatus; status: string }> {
  const o = await loadOwnedOnline(accountId, orderId);
  if (!o.fulfillmentStatus || !(o.fulfillmentStatus in NEXT)) {
    throw new Error("Não há próximo status para este pedido.");
  }
  const next = NEXT[o.fulfillmentStatus as Exclude<FulfillmentStatus, "RECUSADO" | "ENTREGUE">];
  await prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: next } });

  if (next === "ENTREGUE") {
    // Fecha a comanda financeiramente: PIX se havia cobrança online (mesmo se o
    // webhook ainda não confirmou — o lojista só avança a ENTREGUE se recebeu),
    // DINHEIRO se era pagar-na-entrega.
    const payment = o.onlineChargeProvider ? "PIX" : "DINHEIRO";
    await closeOrder(accountId, orderId, { payment });
  }
  return { fulfillmentStatus: next, status: next === "ENTREGUE" ? "FECHADA" : "ABERTA" };
}

/** Avisa o lojista que entrou um novo pedido online (best-effort, não bloqueia). */
export { notifyMerchantNewOnlineOrder };
