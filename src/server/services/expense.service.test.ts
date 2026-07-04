import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  createExpense, listPayable, listPaid, payExpense, updateExpense, deleteExpense,
} from "./expense.service";
import { createRecurring, listRecurring, updateRecurring, deleteRecurring, ensureRecurringForMonth } from "./expense.service";

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
    expect((await listPaid(a)).items.map((x) => x.id)).toContain(e.id);
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

describe("expense.service — recorrência", () => {
  it("gera 1 despesa por mês, idempotente, e clampa o vencimento", async () => {
    const a = await makeOwner();
    await createRecurring(a, { description: "Aluguel", amountCents: 150000, category: "ALUGUEL", dayOfMonth: 31, createdById: a });

    const gen1 = await ensureRecurringForMonth(a, "2026-02");
    expect(gen1).toBe(1); // 1 criada
    const pay = await listPayable(a);
    expect(pay).toHaveLength(1);
    expect(pay[0].description).toBe("Aluguel");
    expect(pay[0].dueDate.slice(0, 10)).toBe("2026-02-28"); // clamp de fev

    const gen2 = await ensureRecurringForMonth(a, "2026-02");
    expect(gen2).toBe(0); // idempotente — não duplica
    expect(await listPayable(a)).toHaveLength(1);
  });

  it("template inativo não gera", async () => {
    const a = await makeOwner();
    const r = await createRecurring(a, { description: "Net", amountCents: 10000, category: "CONTAS", dayOfMonth: 10, createdById: a });
    await updateRecurring(a, r.id, { active: false });
    expect(await ensureRecurringForMonth(a, "2026-07")).toBe(0);
    expect(await listPayable(a)).toHaveLength(0);
  });

  it("recorrentes escopados por conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const r = await createRecurring(a, { description: "X", amountCents: 100, dayOfMonth: 5, createdById: a });
    await expect(updateRecurring(b, r.id, { amountCents: 1 })).rejects.toThrow();
    await expect(deleteRecurring(b, r.id)).rejects.toThrow();
    expect(await listRecurring(a)).toHaveLength(1);
    expect(await listRecurring(b)).toHaveLength(0);
  });
});

describe("expense.service — filtro de A pagar", () => {
  it("filtra pendentes por intervalo de vencimento e por descrição", async () => {
    const a = await makeOwner();
    await createExpense(a, { description: "Aluguel sala", amountCents: 1000, dueDate: "2026-07-05", createdById: a });
    await createExpense(a, { description: "Luz", amountCents: 2000, dueDate: "2026-07-20", createdById: a });
    await createExpense(a, { description: "Internet", amountCents: 3000, dueDate: "2026-08-10", createdById: a });

    // por data (só julho)
    const jul = await listPayable(a, {
      from: new Date("2026-07-01T00:00:00-03:00"),
      to: new Date("2026-07-31T23:59:59-03:00"),
    });
    expect(jul.map((e) => e.description).sort()).toEqual(["Aluguel sala", "Luz"]);

    // por texto (case-insensitive)
    const alug = await listPayable(a, { query: "aluguel" });
    expect(alug).toHaveLength(1);
    expect(alug[0].description).toBe("Aluguel sala");

    // sem filtro = tudo
    expect(await listPayable(a)).toHaveLength(3);
  });
});

describe("expense.service — extrato de Pagas", () => {
  it("filtra pagas por período (paidAt) e descrição, com total e paginação", async () => {
    const a = await makeOwner();
    // 3 pagas + 1 pendente
    for (const [desc, val] of [["Fornecedor A", 1000], ["Fornecedor B", 2000], ["Aluguel", 3000]] as const) {
      const e = await createExpense(a, { description: desc, amountCents: val, dueDate: "2026-07-05", createdById: a });
      await payExpense(a, e.id);
    }
    await createExpense(a, { description: "Pendente", amountCents: 9, dueDate: "2026-07-05", createdById: a });

    const all = await listPaid(a);
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(3);

    // busca por texto
    const forn = await listPaid(a, { query: "fornecedor" });
    expect(forn.total).toBe(2);

    // paginação: take=2 → 2 itens mas total=3
    const page1 = await listPaid(a, { take: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);

    // período que não pega nada (mês passado)
    const empty = await listPaid(a, {
      from: new Date("2026-06-01T00:00:00-03:00"),
      to: new Date("2026-06-30T23:59:59-03:00"),
    });
    expect(empty.total).toBe(0);
  });
});
