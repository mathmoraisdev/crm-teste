import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { recordEntry, recordAdjustment, listStock, lowStockItems, listMovements, applyOrderStockExit, reverseOrderStockExit } from "./stock.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `stk_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}
async function makeProduct(acc: string, name: string, min = 0) {
  const item = await createCatalogItem(acc, { name, priceCents: 1000, kind: "PRODUTO", trackStock: true, minStock: min });
  return item.id;
}

describe("stock.service", () => {
  it("entrada soma e registra movimento com balanceAfter", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Pomada");
    await recordEntry(acc, id, { qty: 10, createdById: acc, reason: "compra" });
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(10);
    const mv = await listMovements(acc, id);
    expect(mv[0].kind).toBe("ENTRADA");
    expect(mv[0].delta).toBe(10);
    expect(mv[0].balanceAfter).toBe(10);
  });

  it("ajuste acerta pra quantidade contada (inventário)", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Óleo");
    await recordEntry(acc, id, { qty: 5, createdById: acc });
    await recordAdjustment(acc, id, { newQty: 3, createdById: acc, reason: "inventário" });
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(3);
    const mv = await listMovements(acc, id);
    expect(mv[0].kind).toBe("AJUSTE");
    expect(mv[0].delta).toBe(-2);
  });

  it("baixo estoque aparece quando <= mínimo", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Shampoo", 5);
    await recordEntry(acc, id, { qty: 4, createdById: acc });
    expect((await lowStockItems(acc)).map((x) => x.id)).toContain(id);
    await recordEntry(acc, id, { qty: 10, createdById: acc }); // 14 > 5
    expect((await lowStockItems(acc)).map((x) => x.id)).not.toContain(id);
  });

  it("rejeita qtd inválida, item de outra conta e item sem trackStock", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const id = await makeProduct(acc, "Cera");
    await expect(recordEntry(acc, id, { qty: 0, createdById: acc })).rejects.toThrow();
    await expect(recordEntry(other, id, { qty: 1, createdById: other })).rejects.toThrow();
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    await expect(recordEntry(acc, svc.id, { qty: 1, createdById: acc })).rejects.toThrow();
  });

  it("reverte a baixa de venda com ENTRADA de compensação (idempotente)", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Água");
    await recordEntry(acc, id, { qty: 10, createdById: acc });
    const order = await prisma.order.create({ data: { accountId: acc, openedById: acc, status: "FECHADA" } });

    // baixa de venda: 10 → 8
    await prisma.$transaction((tx) => applyOrderStockExit(tx, acc, [{ catalogItemId: id, quantity: 2 }], order.id, acc));
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(8);

    // estorno: volta a 10 com um ENTRADA ligado à comanda
    await prisma.$transaction((tx) => reverseOrderStockExit(tx, acc, order.id, acc));
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(10);
    const mv = await listMovements(acc, id);
    expect(mv[0].kind).toBe("ENTRADA");
    expect(mv[0].delta).toBe(2);
    expect(mv[0].orderId).toBe(order.id);

    // idempotente: uma segunda reversão não mexe no saldo (líquido já zerado)
    await prisma.$transaction((tx) => reverseOrderStockExit(tx, acc, order.id, acc));
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(10);
  });
});
