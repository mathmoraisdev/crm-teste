import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, removeItem, closeOrder, listOpenOrders, orderTotalCents } from "./order.service";
import { recordEntry, listStock, listMovements } from "./stock.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `ord_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("orderTotalCents (puro)", () => {
  it("soma preço × quantidade", () => {
    expect(orderTotalCents([{ unitPriceCents: 4000, quantity: 1 }, { unitPriceCents: 2500, quantity: 2 }])).toBe(9000);
  });
  it("comanda vazia = 0", () => {
    expect(orderTotalCents([])).toBe(0);
  });
});

describe("order.service (ciclo)", () => {
  it("abre avulsa, adiciona itens (snapshot), calcula total, fecha", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const order = await openOrder(acc, { openedById: acc, customerName: "João" });
    expect(order.status).toBe("ABERTA");

    await addItem(acc, order.id, { catalogItemId: corte.id, quantity: 1 });
    await addItem(acc, order.id, { name: "Gorjeta", unitPriceCents: 500, quantity: 1 }); // linha avulsa

    // snapshot: reajustar o catálogo NÃO muda a comanda
    await prisma.catalogItem.update({ where: { id: corte.id }, data: { priceCents: 9999 } });

    const full = await closeOrder(acc, order.id, { payment: "DINHEIRO" });
    expect(full.status).toBe("FECHADA");
    expect(full.closedAt).toBeTruthy();
    expect(full.totalCents).toBe(4500); // 4000 (snapshot) + 500
  });

  it("listOpenOrders só traz ABERTAS da própria conta", async () => {
    const acc = await makeOwner();
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    expect((await listOpenOrders(acc)).map((x) => x.id)).toContain(o.id);
    await closeOrder(acc, o.id, { payment: "PIX" });
    expect((await listOpenOrders(acc)).map((x) => x.id)).not.toContain(o.id);
  });

  it("não deixa outra conta mexer na comanda", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await expect(addItem(other, o.id, { name: "Y", unitPriceCents: 100, quantity: 1 })).rejects.toThrow();
  });
});

describe("closeOrder — baixa de estoque", () => {
  it("baixa o estoque do produto rastreado ao fechar", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Pomada", priceCents: 2500, kind: "PRODUTO", trackStock: true });
    await recordEntry(acc, prod.id, { qty: 10, createdById: acc });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await addItem(acc, o.id, { catalogItemId: prod.id, quantity: 3 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    expect((await listStock(acc)).find((x) => x.id === prod.id)?.stockQty).toBe(7);
    const mv = await listMovements(acc, prod.id);
    expect(mv[0].kind).toBe("SAIDA");
    expect(mv[0].delta).toBe(-3);
    expect(mv[0].orderId).toBe(o.id);
  });

  it("não mexe em estoque de serviço nem de linha avulsa", async () => {
    const acc = await makeOwner();
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    const o = await openOrder(acc, { openedById: acc, customerName: "Y" });
    await addItem(acc, o.id, { catalogItemId: svc.id, quantity: 1 });
    await addItem(acc, o.id, { name: "Gorjeta", unitPriceCents: 500, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "PIX", closedById: acc });
    expect(await listMovements(acc, svc.id)).toHaveLength(0);
  });

  it("permite estoque negativo (não bloqueia a venda)", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Cera", priceCents: 1000, kind: "PRODUTO", trackStock: true });
    await recordEntry(acc, prod.id, { qty: 1, createdById: acc });
    const o = await openOrder(acc, { openedById: acc, customerName: "Z" });
    await addItem(acc, o.id, { catalogItemId: prod.id, quantity: 5 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    expect((await listStock(acc)).find((x) => x.id === prod.id)?.stockQty).toBe(-4);
  });

  it("refechar não dá baixa em dobro (guarda idempotente)", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Gel", priceCents: 1500, kind: "PRODUTO", trackStock: true });
    await recordEntry(acc, prod.id, { qty: 10, createdById: acc });
    const o = await openOrder(acc, { openedById: acc, customerName: "W" });
    await addItem(acc, o.id, { catalogItemId: prod.id, quantity: 4 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    await expect(closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc })).rejects.toThrow();
    expect((await listStock(acc)).find((x) => x.id === prod.id)?.stockQty).toBe(6); // 10 − 4, uma vez só
    expect(await listMovements(acc, prod.id)).toHaveLength(2); // ENTRADA + 1 SAIDA (não 2)
  });
});
