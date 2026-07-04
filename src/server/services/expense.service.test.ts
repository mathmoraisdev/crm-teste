import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  createExpense, listPayable, listPaid, payExpense, updateExpense, deleteExpense,
} from "./expense.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `exp_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("expense.service", () => {
  it("cria conta a pagar (pendente) e lista escopado", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createExpense(a, { description: "Aluguel", amountCents: 150000, category: "ALUGUEL", dueDate: "2026-07-05", createdById: a });
    await createExpense(b, { description: "Luz", amountCents: 20000, category: "CONTAS", dueDate: "2026-07-10", createdById: b });
    const payA = await listPayable(a);
    expect(payA).toHaveLength(1);
    expect(payA[0].description).toBe("Aluguel");
    expect(payA[0].status).toBe("PENDENTE");
  });

  it("rejeita descrição vazia e valor negativo", async () => {
    const a = await makeOwner();
    await expect(createExpense(a, { description: "  ", amountCents: 100, dueDate: "2026-07-01", createdById: a })).rejects.toThrow();
    await expect(createExpense(a, { description: "X", amountCents: -1, dueDate: "2026-07-01", createdById: a })).rejects.toThrow();
  });

  it("nasce já paga quando paidNow=true", async () => {
    const a = await makeOwner();
    const e = await createExpense(a, { description: "Material", amountCents: 5000, dueDate: "2026-07-04", createdById: a, paidNow: true });
    expect(e.status).toBe("PAGA");
    expect(e.paidAt).toBeTruthy();
    expect(await listPayable(a)).toHaveLength(0);
    expect((await listPaid(a)).map((x) => x.id)).toContain(e.id);
  });

  it("payExpense marca paga e sai da lista de a pagar", async () => {
    const a = await makeOwner();
    const e = await createExpense(a, { description: "Fornecedor", amountCents: 30000, dueDate: "2026-07-08", createdById: a });
    const paid = await payExpense(a, e.id);
    expect(paid.status).toBe("PAGA");
    expect(paid.paidAt).toBeTruthy();
    expect(await listPayable(a)).toHaveLength(0);
  });

  it("não deixa outra conta pagar/editar/excluir", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const e = await createExpense(a, { description: "X", amountCents: 100, dueDate: "2026-07-01", createdById: a });
    await expect(payExpense(b, e.id)).rejects.toThrow();
    await expect(updateExpense(b, e.id, { amountCents: 1 })).rejects.toThrow();
    await expect(deleteExpense(b, e.id)).rejects.toThrow();
  });
});
