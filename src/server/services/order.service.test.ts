import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, removeItem, closeOrder, listOpenOrders, orderTotalCents } from "./order.service";

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
