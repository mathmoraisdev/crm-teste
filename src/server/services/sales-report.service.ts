import { prisma } from "@/server/db/client";
import type { OrderPayment } from "@prisma/client";
import { orderTotalCents } from "./order.service";

export interface SalesSummary { totalCents: number; orderCount: number; avgTicketCents: number; }

async function closedOrderIds(accountId: string, from: Date, to: Date): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function salesSummary(accountId: string, from: Date, to: Date): Promise<SalesSummary> {
  // Faturamento = Σ do total DERIVADO por comanda (aplica desconto/taxa/gorjeta),
  // p/ reconciliar com os recibos e com revenueByPayment. Somar só Σ(itens)
  // ignoraria os ajustes e infla/deforma o número exibido no painel.
  const orders = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: {
      discountCents: true, surchargeCents: true, tipCents: true,
      items: { select: { unitPriceCents: true, quantity: true } },
    },
  });
  if (!orders.length) return { totalCents: 0, orderCount: 0, avgTicketCents: 0 };
  const totalCents = orders.reduce((s, o) => s + orderTotalCents(o), 0);
  const orderCount = orders.length;
  return { totalCents, orderCount, avgTicketCents: Math.round(totalCents / orderCount) };
}

/** Receita por meio de pagamento no período. Agrega por OrderTender (uma comanda
 * com 2 meios aparece nos dois). Retrocompat: comanda fechada antes dos tenders
 * (sem linhas) cai no `Order.payment` único, com o total derivado. */
export async function revenueByPayment(accountId: string, from: Date, to: Date): Promise<{ payment: OrderPayment; totalCents: number }[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: {
      payment: true,
      discountCents: true, surchargeCents: true, tipCents: true,
      tenders: { select: { method: true, amountCents: true } },
      items: { select: { unitPriceCents: true, quantity: true } },
    },
  });
  const map = new Map<OrderPayment, number>();
  const add = (method: OrderPayment, cents: number) => map.set(method, (map.get(method) ?? 0) + cents);
  for (const o of orders) {
    if (o.tenders.length > 0) {
      for (const t of o.tenders) add(t.method, t.amountCents);
    } else if (o.payment) {
      add(o.payment, orderTotalCents(o)); // legado: meio único + total derivado
    }
  }
  return [...map.entries()].map(([payment, totalCents]) => ({ payment, totalCents }));
}

export interface OperatorRevenue { operatorId: string; operatorName: string; totalCents: number; orderCount: number; }

/** Faturamento e nº de comandas por operador (quem lançou), maior receita primeiro. */
export async function revenueByOperator(accountId: string, from: Date, to: Date): Promise<OperatorRevenue[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: {
      openedById: true, openedBy: { select: { name: true } },
      discountCents: true, surchargeCents: true, tipCents: true,
      items: { select: { unitPriceCents: true, quantity: true } },
    },
  });
  const map = new Map<string, { name: string; totalCents: number; orderCount: number }>();
  for (const o of orders) {
    const t = orderTotalCents(o); // aplica os ajustes p/ reconciliar com o faturamento
    const cur = map.get(o.openedById) ?? { name: o.openedBy?.name ?? "—", totalCents: 0, orderCount: 0 };
    cur.totalCents += t;
    cur.orderCount += 1;
    map.set(o.openedById, cur);
  }
  return [...map.entries()]
    .map(([operatorId, v]) => ({ operatorId, operatorName: v.name, totalCents: v.totalCents, orderCount: v.orderCount }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export async function topItems(accountId: string, from: Date, to: Date, limit = 10): Promise<{ name: string; quantity: number; totalCents: number }[]> {
  const ids = await closedOrderIds(accountId, from, to);
  if (!ids.length) return [];
  const items = await prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: { nameSnapshot: true, unitPriceCents: true, quantity: true } });
  const map = new Map<string, { quantity: number; totalCents: number }>();
  for (const i of items) {
    const cur = map.get(i.nameSnapshot) ?? { quantity: 0, totalCents: 0 };
    cur.quantity += i.quantity; cur.totalCents += i.unitPriceCents * i.quantity;
    map.set(i.nameSnapshot, cur);
  }
  return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.totalCents - a.totalCents).slice(0, limit);
}
