import { prisma } from "@/server/db/client";
import type { OrderPayment, OrderStatus } from "@prisma/client";
import { orderTotalCents } from "./order.service";

export interface SalesHistoryRow {
  id: string;
  status: OrderStatus;
  closedAt: string;
  customerName: string | null;
  leadId: string | null;
  operatorName: string;
  payment: OrderPayment | null;
  discountCents: number | null;
  surchargeCents: number | null;
  totalCents: number;
  canceledReason: string | null;
}
export interface SalesHistoryPage { items: SalesHistoryRow[]; total: number; }

export async function listSalesHistory(
  accountId: string,
  opts: { from: Date; to: Date; operatorId?: string; query?: string; skip?: number; take?: number; includeCanceled?: boolean },
): Promise<SalesHistoryPage> {
  const where = {
    accountId,
    // Extrato = comandas FECHADA. Canceladas ficam fora por padrão; `includeCanceled`
    // as traz (view-only, marcadas/riscadas na UI). Canceladas mantêm `closedAt`, então
    // o filtro por período continua valendo.
    status: opts.includeCanceled ? { in: ["FECHADA", "CANCELADA"] as OrderStatus[] } : ("FECHADA" as const),
    closedAt: { gte: opts.from, lte: opts.to },
    ...(opts.operatorId ? { openedById: opts.operatorId } : {}),
    ...(opts.query?.trim()
      ? { customerName: { contains: opts.query.trim(), mode: "insensitive" as const } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { closedAt: "desc" },
      skip: opts.skip ?? 0,
      take: opts.take ?? 50,
      select: {
        id: true, status: true, closedAt: true, customerName: true, leadId: true, payment: true,
        discountCents: true, surchargeCents: true, tipCents: true, canceledReason: true,
        openedBy: { select: { name: true } },
        items: { select: { unitPriceCents: true, quantity: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  const items: SalesHistoryRow[] = rows.map((o) => ({
    id: o.id,
    status: o.status,
    closedAt: (o.closedAt ?? new Date(0)).toISOString(),
    customerName: o.customerName,
    leadId: o.leadId,
    operatorName: o.openedBy?.name ?? "—",
    payment: o.payment,
    discountCents: o.discountCents,
    surchargeCents: o.surchargeCents,
    totalCents: orderTotalCents(o),
    canceledReason: o.canceledReason,
  }));
  return { items, total };
}

/** Operadores distintos que fecharam comandas (p/ o filtro do extrato). */
export async function listSalesOperators(accountId: string): Promise<{ id: string; name: string }[]> {
  const ids = await prisma.order.findMany({
    where: { accountId, status: "FECHADA" },
    distinct: ["openedById"],
    select: { openedById: true },
  });
  if (!ids.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids.map((r) => r.openedById) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}
