import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder } from "./order.service";
import { salesSummary, topItems, revenueByPayment, revenueByOperator } from "./sales-report.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `rep_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}

describe("sales-report.service", () => {
  it("resumo soma só comandas fechadas e calcula ticket médio", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o1 = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o1.id, { catalogItemId: corte.id, quantity: 2 }); // 8000
    await closeOrder(acc, o1.id, { payment: "DINHEIRO" });
    const o2 = await openOrder(acc, { openedById: acc, customerName: "B" });
    await addItem(acc, o2.id, { catalogItemId: corte.id, quantity: 1 }); // 4000
    await closeOrder(acc, o2.id, { payment: "PIX" });
    await openOrder(acc, { openedById: acc, customerName: "C" }); // ABERTA — não conta

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const s = await salesSummary(acc, from, to);
    expect(s.totalCents).toBe(12000);
    expect(s.orderCount).toBe(2);
    expect(s.avgTicketCents).toBe(6000);

    const byPay = await revenueByPayment(acc, from, to);
    expect(byPay.find((p) => p.payment === "DINHEIRO")?.totalCents).toBe(8000);
    expect(byPay.find((p) => p.payment === "PIX")?.totalCents).toBe(4000);

    const top = await topItems(acc, from, to, 5);
    expect(top[0].name).toBe("Corte");
    expect(top[0].quantity).toBe(3);
    expect(top[0].totalCents).toBe(12000);
  });

  it("revenueByOperator soma por quem lançou e ordena por receita", async () => {
    const acc = await makeOwner();
    const op = await prisma.user.create({ data: { email: `repop_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Op", passwordHash: "x", ownerId: acc, role: "OPERADOR" } });
    const item = await createCatalogItem(acc, { name: "Serviço", priceCents: 5000 });

    // Dono: 1 comanda de 5000
    const d1 = await openOrder(acc, { openedById: acc, customerName: "X" });
    await addItem(acc, d1.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, d1.id, { payment: "DINHEIRO" });
    // Op: 2 comandas somando 15000
    const p1 = await openOrder(acc, { openedById: op.id, customerName: "Y" });
    await addItem(acc, p1.id, { catalogItemId: item.id, quantity: 2 }); // 10000
    await closeOrder(acc, p1.id, { payment: "PIX" });
    const p2 = await openOrder(acc, { openedById: op.id, customerName: "Z" });
    await addItem(acc, p2.id, { catalogItemId: item.id, quantity: 1 }); // 5000
    await closeOrder(acc, p2.id, { payment: "PIX" });

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const byOp = await revenueByOperator(acc, from, to);
    expect(byOp.map((o) => o.operatorName)).toEqual(["Op", "T"]); // maior receita primeiro
    expect(byOp[0]).toMatchObject({ operatorName: "Op", totalCents: 15000, orderCount: 2 });
    expect(byOp[1]).toMatchObject({ operatorName: "T", totalCents: 5000, orderCount: 1 });
  });
});
