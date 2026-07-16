import { prisma } from "@/server/db/client";
import type { ExpenseCategory } from "@prisma/client";

export async function expensesTotal(accountId: string, from: Date, to: Date): Promise<number> {
  const agg = await prisma.expense.aggregate({
    where: { accountId, status: "PAGA", paidAt: { gte: from, lte: to } },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

export async function expensesByCategory(accountId: string, from: Date, to: Date): Promise<{ category: ExpenseCategory; totalCents: number }[]> {
  const rows = await prisma.expense.groupBy({
    by: ["category"],
    where: { accountId, status: "PAGA", paidAt: { gte: from, lte: to } },
    _sum: { amountCents: true },
  });
  return rows
    .map((r) => ({ category: r.category, totalCents: r._sum.amountCents ?? 0 }))
    .sort((a, b) => b.totalCents - a.totalCents);
}
