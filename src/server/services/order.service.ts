import { prisma } from "@/server/db/client";
import type { OrderPayment, OrderStatus } from "@prisma/client";
import { applyOrderStockExit } from "./stock.service";

export interface OrderItemDTO { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null; }
export interface OrderDTO {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: string; closedAt: string | null;
  items: OrderItemDTO[]; totalCents: number;
}

/** Soma pura — total derivado dos itens. */
export function orderTotalCents(items: { unitPriceCents: number; quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

function toDTO(o: {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: Date; closedAt: Date | null;
  items: { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null }[];
}): OrderDTO {
  const items = o.items.map((i) => ({ id: i.id, nameSnapshot: i.nameSnapshot, unitPriceCents: i.unitPriceCents, quantity: i.quantity, catalogItemId: i.catalogItemId }));
  return {
    id: o.id, status: o.status, leadId: o.leadId, customerName: o.customerName,
    payment: o.payment, note: o.note, createdAt: o.createdAt.toISOString(),
    closedAt: o.closedAt ? o.closedAt.toISOString() : null, items, totalCents: orderTotalCents(items),
  };
}

async function loadOwned(accountId: string, id: string) {
  const o = await prisma.order.findFirst({ where: { id, accountId }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (!o) throw new Error("Comanda não encontrada.");
  return o;
}

export async function openOrder(
  accountId: string,
  data: { openedById: string; leadId?: string | null; customerName?: string | null },
): Promise<OrderDTO> {
  const o = await prisma.order.create({
    data: {
      accountId, openedById: data.openedById,
      leadId: data.leadId ?? null,
      customerName: data.leadId ? null : (data.customerName?.trim() || "Sem nome"),
    },
    include: { items: true },
  });
  return toDTO(o);
}

export async function addItem(
  accountId: string,
  orderId: string,
  data: { catalogItemId?: string; name?: string; unitPriceCents?: number; quantity?: number },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const qty = Math.max(1, Math.floor(data.quantity ?? 1));

  let nameSnapshot: string;
  let unitPriceCents: number;
  let catalogItemId: string | null = null;

  if (data.catalogItemId) {
    const ci = await prisma.catalogItem.findFirst({ where: { id: data.catalogItemId, accountId } });
    if (!ci) throw new Error("Item do catálogo não encontrado.");
    nameSnapshot = ci.name; unitPriceCents = ci.priceCents; catalogItemId = ci.id;
  } else {
    if (!data.name?.trim()) throw new Error("Informe o item.");
    if (!Number.isInteger(data.unitPriceCents) || (data.unitPriceCents ?? -1) < 0) throw new Error("Preço inválido.");
    nameSnapshot = data.name.trim(); unitPriceCents = data.unitPriceCents!;
  }

  await prisma.orderItem.create({ data: { orderId, catalogItemId, nameSnapshot, unitPriceCents, quantity: qty } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function removeItem(accountId: string, orderId: string, itemId: string): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const owned = order.items.find((i) => i.id === itemId);
  if (!owned) throw new Error("Item não encontrado.");
  await prisma.orderItem.delete({ where: { id: itemId } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function closeOrder(
  accountId: string,
  orderId: string,
  data: { payment: OrderPayment; note?: string; closedById?: string },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId); // já inclui items
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const closerId = data.closedById ?? order.openedById;
  await prisma.$transaction(async (tx) => {
    // Guarda atômica: o UPDATE condicionado a status=ABERTA é o árbitro. Se dois
    // fechamentos concorrerem (duplo-clique), só um afeta linhas — o outro vê count=0
    // e aborta ANTES da baixa, evitando decremento/​SAIDA em dobro.
    const res = await tx.order.updateMany({
      where: { id: orderId, status: "ABERTA" },
      data: { status: "FECHADA", payment: data.payment, note: data.note?.trim() || null, closedAt: new Date() },
    });
    if (res.count === 0) throw new Error("Comanda já fechada.");
    await applyOrderStockExit(tx, accountId, order.items, orderId, closerId);
  });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function listOpenOrders(accountId: string): Promise<OrderDTO[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "ABERTA" },
    include: { items: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return orders.map(toDTO);
}

export async function getOrder(accountId: string, id: string): Promise<OrderDTO> {
  return toDTO(await loadOwned(accountId, id));
}
