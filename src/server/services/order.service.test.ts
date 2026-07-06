import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { createDef } from "./custom-field.service";
import { openOrder, addItem, removeItem, closeOrder, listOpenOrders, orderTotalCents, setItemQuantity, setOrderAdjustments, setOrderItemCustomFields, getReceiptData } from "./order.service";
import { recordEntry, listStock, listMovements } from "./stock.service";
import { openSession } from "./cash-session.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `ord_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("orderTotalCents (puro)", () => {
  it("soma preço × quantidade", () => {
    expect(orderTotalCents({ items: [{ unitPriceCents: 4000, quantity: 1 }, { unitPriceCents: 2500, quantity: 2 }] })).toBe(9000);
  });
  it("comanda vazia = 0", () => {
    expect(orderTotalCents({ items: [] })).toBe(0);
  });

  const itens = [{ unitPriceCents: 10000, quantity: 1 }]; // Σ = 10000
  it("aplica desconto sobre o subtotal", () => {
    expect(orderTotalCents({ items: itens, discountCents: 1500 })).toBe(8500);
  });
  it("aplica acréscimo/taxa e gorjeta sobre o subtotal já com desconto", () => {
    // 10000 − 1500 = 8500; + 850 (taxa 10%) = 9350; + 500 gorjeta = 9850
    expect(orderTotalCents({ items: itens, discountCents: 1500, surchargeCents: 850, tipCents: 500 })).toBe(9850);
  });
  it("desconto maior que o subtotal clampa o subtotal em 0 (não negativo)", () => {
    // desconto 12000 > 10000 → subtotal 0; acréscimo/gorjeta ainda somam
    expect(orderTotalCents({ items: itens, discountCents: 12000, surchargeCents: 300 })).toBe(300);
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

describe("setItemQuantity — quantidade editável", () => {
  it("altera a qtd do item e recalcula o total da comanda", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: corte.id, quantity: 1 });
    const itemId = withItem.items[0].id;
    const upd = await setItemQuantity(acc, o.id, itemId, 3);
    expect(upd.items[0].quantity).toBe(3);
    expect(upd.totalCents).toBe(12000); // 3 × 4000
  });

  it("rejeita quantidade < 1", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: corte.id, quantity: 1 });
    await expect(setItemQuantity(acc, o.id, withItem.items[0].id, 0)).rejects.toThrow();
  });

  it("recusa alterar item de comanda FECHADA", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: corte.id, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    await expect(setItemQuantity(acc, o.id, withItem.items[0].id, 2)).rejects.toThrow(/fechada/i);
  });
});

describe("setOrderAdjustments — desconto/acréscimo/gorjeta", () => {
  async function abertaCom10000(acc: string) {
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 10000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    return o;
  }

  it("grava ajustes e recalcula o total derivado", async () => {
    const acc = await makeOwner();
    const o = await abertaCom10000(acc);
    const upd = await setOrderAdjustments(acc, o.id, { discountCents: 1500, surchargeCents: 850, tipCents: 500, tableLabel: "Mesa 3" });
    expect(upd.discountCents).toBe(1500);
    expect(upd.surchargeCents).toBe(850);
    expect(upd.tipCents).toBe(500);
    expect(upd.tableLabel).toBe("Mesa 3");
    expect(upd.totalCents).toBe(9850); // max(0,10000-1500)+850+500
  });

  it("rejeita desconto maior que o subtotal", async () => {
    const acc = await makeOwner();
    const o = await abertaCom10000(acc);
    await expect(setOrderAdjustments(acc, o.id, { discountCents: 12000 })).rejects.toThrow(/subtotal/i);
  });

  it("rejeita valores negativos", async () => {
    const acc = await makeOwner();
    const o = await abertaCom10000(acc);
    await expect(setOrderAdjustments(acc, o.id, { surchargeCents: -100 })).rejects.toThrow();
  });

  it("null limpa o ajuste", async () => {
    const acc = await makeOwner();
    const o = await abertaCom10000(acc);
    await setOrderAdjustments(acc, o.id, { discountCents: 1000 });
    const upd = await setOrderAdjustments(acc, o.id, { discountCents: null });
    expect(upd.discountCents).toBeNull();
    expect(upd.totalCents).toBe(10000);
  });

  it("recusa comanda FECHADA", async () => {
    const acc = await makeOwner();
    const o = await abertaCom10000(acc);
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    await expect(setOrderAdjustments(acc, o.id, { tipCents: 200 })).rejects.toThrow(/fechada/i);
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

describe("closeOrder — multi-pagamento e troco", () => {
  async function abertaCom(acc: string, precoCents: number) {
    const item = await createCatalogItem(acc, { name: "Item", priceCents: precoCents });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    return o;
  }

  it("um tender DINHEIRO com valor recebido → troco derivado", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 9850);
    const full = await closeOrder(acc, o.id, {
      tenders: [{ method: "DINHEIRO", amountCents: 10000 }],
      amountTenderedCents: 10000,
      closedById: acc,
    });
    expect(full.status).toBe("FECHADA");
    expect(full.changeCents).toBe(150); // 10000 − 9850
    expect(full.payment).toBe("DINHEIRO");
    const tenders = await prisma.orderTender.findMany({ where: { orderId: o.id } });
    expect(tenders).toHaveLength(1);
    expect(tenders[0].amountCents).toBe(10000);
  });

  it("meios mistos (PIX + DINHEIRO) somam o total → payment OUTRO, sem troco", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 9850);
    const full = await closeOrder(acc, o.id, {
      tenders: [{ method: "PIX", amountCents: 5000 }, { method: "DINHEIRO", amountCents: 4850 }],
      closedById: acc,
    });
    expect(full.payment).toBe("OUTRO");
    expect(full.changeCents ?? 0).toBe(0);
    expect(await prisma.orderTender.count({ where: { orderId: o.id } })).toBe(2);
  });

  it("parcial: sem allowPartial lança; com a flag, fecha com saldo", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 9850);
    await expect(closeOrder(acc, o.id, { tenders: [{ method: "PIX", amountCents: 5000 }], closedById: acc })).rejects.toThrow();
    const full = await closeOrder(acc, o.id, { tenders: [{ method: "PIX", amountCents: 5000 }], allowPartial: true, closedById: acc });
    expect(full.status).toBe("FECHADA");
    expect(full.payment).toBe("PIX");
  });

  it("retrocompat: { payment } vira um tender do total", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 4000);
    const full = await closeOrder(acc, o.id, { payment: "PIX", closedById: acc });
    expect(full.payment).toBe("PIX");
    const tenders = await prisma.orderTender.findMany({ where: { orderId: o.id } });
    expect(tenders).toHaveLength(1);
    expect(tenders[0].method).toBe("PIX");
    expect(tenders[0].amountCents).toBe(4000);
  });

  it("guarda de duplo-fechamento continua barrando", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 4000);
    await closeOrder(acc, o.id, { tenders: [{ method: "DINHEIRO", amountCents: 4000 }], closedById: acc });
    await expect(closeOrder(acc, o.id, { tenders: [{ method: "DINHEIRO", amountCents: 4000 }], closedById: acc })).rejects.toThrow();
    expect(await prisma.orderTender.count({ where: { orderId: o.id } })).toBe(1); // não duplicou
  });

  it("troco no misto com dinheiro usa a parcela devida em dinheiro (não o total)", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 9000); // total 90
    const full = await closeOrder(acc, o.id, {
      // PIX 40 + Dinheiro; cliente entrega R$100 em espécie
      tenders: [{ method: "PIX", amountCents: 4000 }, { method: "DINHEIRO", amountCents: 5000 }],
      amountTenderedCents: 10000,
      closedById: acc,
    });
    // devido em dinheiro = 9000 − 4000 = 5000; troco = 10000 − 5000 = 5000 (NÃO 1000)
    expect(full.changeCents).toBe(5000);
  });

  it("troco aplica os ajustes no total (desconto reduz o total, aumenta o troco)", async () => {
    const acc = await makeOwner();
    const o = await abertaCom(acc, 10000);
    await setOrderAdjustments(acc, o.id, { discountCents: 1500 }); // total 8500
    const full = await closeOrder(acc, o.id, {
      tenders: [{ method: "DINHEIRO", amountCents: 10000 }],
      amountTenderedCents: 10000,
      closedById: acc,
    });
    expect(full.changeCents).toBe(1500); // 10000 − 8500
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

describe("closeOrder — numeração sequencial do cupom", () => {
  it("atribui 1, 2 na mesma conta; contas têm sequências independentes", async () => {
    const acc = await makeOwner();
    const o1 = await openOrder(acc, { openedById: acc, customerName: "A" });
    await closeOrder(acc, o1.id, { payment: "DINHEIRO", closedById: acc });
    const o2 = await openOrder(acc, { openedById: acc, customerName: "B" });
    await closeOrder(acc, o2.id, { payment: "PIX", closedById: acc });

    // number não é exposto no DTO — lê do banco
    expect((await prisma.order.findUnique({ where: { id: o1.id } }))!.number).toBe(1);
    expect((await prisma.order.findUnique({ where: { id: o2.id } }))!.number).toBe(2);

    const acc2 = await makeOwner();
    const p1 = await openOrder(acc2, { openedById: acc2, customerName: "C" });
    await closeOrder(acc2, p1.id, { payment: "DINHEIRO", closedById: acc2 });
    expect((await prisma.order.findUnique({ where: { id: p1.id } }))!.number).toBe(1);
  });
});

describe("getReceiptData (dados do recibo, escopado)", () => {
  it("traz itens, número e nome da empresa (default branding)", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "João" });
    await addItem(acc, o.id, { catalogItemId: corte.id, quantity: 2 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    // number é atribuído no fechamento (N1.5); força aqui p/ testar o carry-through
    await prisma.order.update({ where: { id: o.id }, data: { number: 7 } });

    const data = await getReceiptData(acc, o.id);
    expect(data.order.number).toBe(7);
    expect(data.order.customerName).toBe("João");
    expect(data.order.payment).toBe("DINHEIRO");
    expect(data.order.items).toEqual([
      { nameSnapshot: "Corte", quantity: 2, unitPriceCents: 4000 },
    ]);
    expect(data.business.name).toBeTruthy();
  });

  it("recusa comanda de outra conta", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await expect(getReceiptData(other, o.id)).rejects.toThrow();
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

describe("closeOrder — carimbo da sessão de caixa", () => {
  it("com sessão ABERTA, a comanda referencia o cashSessionId", async () => {
    const acc = await makeOwner();
    const s = await openSession(acc, acc, 10000);
    const o = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o.id, { name: "X", unitPriceCents: 4000, quantity: 1 });
    await closeOrder(acc, o.id, { tenders: [{ method: "DINHEIRO", amountCents: 4000 }], closedById: acc });
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.cashSessionId).toBe(s.id);
  });

  it("sem sessão aberta, fecha igual com cashSessionId=null (fora de sessão)", async () => {
    const acc = await makeOwner();
    const o = await openOrder(acc, { openedById: acc, customerName: "B" });
    await addItem(acc, o.id, { name: "Y", unitPriceCents: 4000, quantity: 1 });
    const full = await closeOrder(acc, o.id, { tenders: [{ method: "DINHEIRO", amountCents: 4000 }], closedById: acc });
    expect(full.status).toBe("FECHADA");
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.cashSessionId).toBeNull();
  });
});
