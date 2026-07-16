// src/server/services/payment.service.ts
import { prisma } from "@/server/db/client";
import type { PaymentMethod } from "@prisma/client";

export interface PaymentRow {
  id: string;
  accountId: string;
  accountName: string;
  accountEmail: string;
  amountCents: number;
  method: PaymentMethod | null;
  paidAt: Date;
  coversUntil: Date | null;
}

/** Soma de receita (centavos) entre [from, to). to exclusivo. */
export async function revenueCents(from: Date, to: Date): Promise<number> {
  const r = await prisma.payment.aggregate({
    _sum: { amountCents: true },
    where: { paidAt: { gte: from, lt: to } },
  });
  return r._sum.amountCents ?? 0;
}

/** Receita acumulada de todos os tempos (centavos). */
export async function revenueTotalCents(): Promise<number> {
  const r = await prisma.payment.aggregate({ _sum: { amountCents: true } });
  return r._sum.amountCents ?? 0;
}

/** Extrato: pagamentos no período [from, to), mais recentes primeiro. */
export async function listPayments(from: Date, to: Date): Promise<PaymentRow[]> {
  const rows = await prisma.payment.findMany({
    where: { paidAt: { gte: from, lt: to } },
    orderBy: { paidAt: "desc" },
    select: {
      id: true, accountId: true, amountCents: true, method: true, paidAt: true, coversUntil: true,
      account: { select: { name: true, email: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id, accountId: p.accountId, accountName: p.account.name, accountEmail: p.account.email,
    amountCents: p.amountCents, method: p.method, paidAt: p.paidAt, coversUntil: p.coversUntil,
  }));
}
