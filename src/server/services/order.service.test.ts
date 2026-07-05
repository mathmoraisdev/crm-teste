import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { createDef } from "./custom-field.service";
import { openOrder, addItem, removeItem, closeOrder, listOpenOrders, orderTotalCents, setOrderItemCustomFields } from "./order.service";
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

describe("openOrder — captura de lead por telefone", () => {
  it("com telefone: cria lead e vincula na comanda", async () => {
    const acc = await makeOwner();
    const order = await openOrder(acc, { openedById: acc, customerName: "Zé", customerPhone: "11988887777" });
    expect(order.leadId).toBeTruthy();
    // exibe o nome do lead (a comanda guarda leadId, não duplica o nome)
    expect(order.customerName).toBe("Zé");
    const lead = await prisma.lead.findFirst({ where: { userId: acc, id: order.leadId! } });
    expect(lead).toBeTruthy();
    expect(lead!.name).toBe("Zé");
  });

  it("reabrir com o mesmo telefone não duplica lead", async () => {
    const acc = await makeOwner();
    await openOrder(acc, { openedById: acc, customerPhone: "11988887777" });
    await openOrder(acc, { openedById: acc, customerPhone: "11988887777" });
    expect(await prisma.lead.count({ where: { userId: acc } })).toBe(1);
  });

  it("sem telefone: comanda avulsa pura (não cria lead)", async () => {
    const acc = await makeOwner();
    const order = await openOrder(acc, { openedById: acc, customerName: "Zé" });
    expect(order.leadId).toBeNull();
    expect(await prisma.lead.count({ where: { userId: acc } })).toBe(0);
  });
});

describe("customFields por item da comanda", () => {
  it("grava e valida customFields em item de comanda ABERTA", async () => {
    const acc = await makeOwner();
    await createDef(acc, { label: "Placa", type: "TEXT", scope: "ORDER_ITEM" }); // key => "placa"
    const veiculo = await createCatalogItem(acc, { name: "Civic", priceCents: 7800000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: veiculo.id, quantity: 1 });
    const itemId = withItem.items[0].id;
    const upd = await setOrderItemCustomFields(acc, o.id, itemId, { placa: "ABC1D23" });
    expect(upd.items[0].customFields).toEqual({ placa: "ABC1D23" });
  });

  it("rejeita key fora do escopo ORDER_ITEM", async () => {
    const acc = await makeOwner();
    const veiculo = await createCatalogItem(acc, { name: "Gol", priceCents: 5000000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: veiculo.id, quantity: 1 });
    await expect(setOrderItemCustomFields(acc, o.id, withItem.items[0].id, { fantasma: "x" })).rejects.toThrow();
  });

  it("recusa gravar em comanda FECHADA", async () => {
    const acc = await makeOwner();
    await createDef(acc, { label: "Placa", type: "TEXT", scope: "ORDER_ITEM" });
    const veiculo = await createCatalogItem(acc, { name: "Onix", priceCents: 6000000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: veiculo.id, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    await expect(setOrderItemCustomFields(acc, o.id, withItem.items[0].id, { placa: "X" })).rejects.toThrow(/fechada/i);
  });
});
