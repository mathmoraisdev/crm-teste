import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createExpense, payExpense } from "./expense.service";
import { expensesTotal, expensesByCategory } from "./expense-report.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `erep_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}

describe("expense-report.service", () => {
  it("soma só despesas pagas no período, por categoria", async () => {
    const a = await makeOwner();
    const e1 = await createExpense(a, { description: "Aluguel", amountCents: 150000, category: "ALUGUEL", dueDate: "2026-07-05", createdById: a });
    await payExpense(a, e1.id); // paidAt = agora (dentro do período)
    const e2 = await createExpense(a, { description: "Luz", amountCents: 20000, category: "CONTAS", dueDate: "2026-07-10", createdById: a });
    await payExpense(a, e2.id);
    await createExpense(a, { description: "Água", amountCents: 9000, category: "CONTAS", dueDate: "2026-07-11", createdById: a }); // PENDENTE — não conta

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    expect(await expensesTotal(a, from, to)).toBe(170000);

    const byCat = await expensesByCategory(a, from, to);
    expect(byCat.find((c) => c.category === "ALUGUEL")?.totalCents).toBe(150000);
    expect(byCat.find((c) => c.category === "CONTAS")?.totalCents).toBe(20000);
  });
});
