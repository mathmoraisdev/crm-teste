import { prisma } from "@/server/db/client";
import type { OrderPayment } from "@prisma/client";

export interface SalesSummary { totalCents: number; orderCount: number; avgTicketCents: number; }

async function closedOrderIds(accountId: string, from: Date, to: Date): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function salesSummary(accountId: string, from: Date, to: Date): Promise<SalesSummary> {
  const ids = await closedOrderIds(accountId, from, to);
  if (!ids.length) return { totalCents: 0, orderCount: 0, avgTicketCents: 0 };
  const agg = await prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: { unitPriceCents: true, quantity: true } });
  const totalCents = agg.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const orderCount = ids.length;
  return { totalCents, orderCount, avgTicketCents: Math.round(totalCents / orderCount) };
}

export async function revenueByPayment(accountId: string, from: Date, to: Date): Promise<{ payment: OrderPayment; totalCents: number }[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: { payment: true, items: { select: { unitPriceCents: true, quantity: true } } },
  });
  const map = new Map<OrderPayment, number>();
  for (const o of orders) {
    if (!o.payment) continue;
    const t = o.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    map.set(o.payment, (map.get(o.payment) ?? 0) + t);
  }
  return [...map.entries()].map(([payment, totalCents]) => ({ payment, totalCents }));
}

export interface OperatorRevenue { operatorId: string; operatorName: string; totalCents: number; orderCount: number; }

/** Faturamento e nº de comandas por operador (quem lançou), maior receita primeiro. */
export async function revenueByOperator(accountId: string, from: Date, to: Date): Promise<OperatorRevenue[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: { openedById: true, openedBy: { select: { name: true } }, items: { select: { unitPriceCents: true, quantity: true } } },
  });
  const map = new Map<string, { name: string; totalCents: number; orderCount: number }>();
  for (const o of orders) {
    const t = o.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
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
