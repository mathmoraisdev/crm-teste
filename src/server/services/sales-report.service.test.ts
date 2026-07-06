import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder, voidOrder } from "./order.service";
import { setOrderAdjustments } from "./order.service";
import { salesSummary, topItems, revenueByPayment, revenueByOperator, commissionByProfessional, salesMargin } from "./sales-report.service";
import { createCommissionRule } from "./commission.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `rep_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}
async function makePro(acc: string, name: string) {
  const p = await prisma.professional.create({ data: { accountId: acc, name } });
  return p.id;
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

  it("salesSummary e revenueByOperator aplicam os ajustes (reconciliam com o recibo)", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 10000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    await setOrderAdjustments(acc, o.id, { discountCents: 1500, surchargeCents: 850, tipCents: 500 }); // total 9850
    await closeOrder(acc, o.id, { tenders: [{ method: "PIX", amountCents: 9850 }], closedById: acc });

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const s = await salesSummary(acc, from, to);
    expect(s.totalCents).toBe(9850); // NÃO 10000 (subtotal)
    expect(s.avgTicketCents).toBe(9850);

    const byOp = await revenueByOperator(acc, from, to);
    expect(byOp[0].totalCents).toBe(9850);

    // faturamento (billed) == recebido por meio (fully paid) → reconcilia
    const byPay = await revenueByPayment(acc, from, to);
    expect(byPay.find((p) => p.payment === "PIX")?.totalCents).toBe(9850);
  });

  it("revenueByPayment soma por tender: comanda com 2 meios aparece nos dois", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 9850 });
    const o = await openOrder(acc, { openedById: acc, customerName: "M" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o.id, {
      tenders: [{ method: "PIX", amountCents: 5000 }, { method: "DINHEIRO", amountCents: 4850 }],
      closedById: acc,
    });

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const byPay = await revenueByPayment(acc, from, to);
    expect(byPay.find((p) => p.payment === "PIX")?.totalCents).toBe(5000);
    expect(byPay.find((p) => p.payment === "DINHEIRO")?.totalCents).toBe(4850);
  });

  it("revenueByPayment: comanda legada (sem tenders) cai no payment + total derivado", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 4000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "L" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "CARTAO", closedById: acc });
    // Simula comanda fechada antes dos tenders: apaga as linhas, mantém Order.payment.
    await prisma.orderTender.deleteMany({ where: { orderId: o.id } });

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const byPay = await revenueByPayment(acc, from, to);
    expect(byPay.find((p) => p.payment === "CARTAO")?.totalCents).toBe(4000);
  });

  it("comanda estornada (CANCELADA) sai de todos os agregados", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    // fechada que conta
    const keep = await openOrder(acc, { openedById: acc, customerName: "Fica" });
    await addItem(acc, keep.id, { catalogItemId: corte.id, quantity: 1 }); // 4000
    await closeOrder(acc, keep.id, { payment: "DINHEIRO", closedById: acc });
    // fechada e depois estornada — não pode contar em lugar nenhum
    const gone = await openOrder(acc, { openedById: acc, customerName: "Estornada" });
    await addItem(acc, gone.id, { catalogItemId: corte.id, quantity: 5 }); // 20000
    await closeOrder(acc, gone.id, { payment: "PIX", closedById: acc });
    await voidOrder(acc, gone.id, "valor errado", acc);

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);

    const s = await salesSummary(acc, from, to);
    expect(s.totalCents).toBe(4000); // só a que ficou
    expect(s.orderCount).toBe(1);

    const byPay = await revenueByPayment(acc, from, to);
    expect(byPay.find((p) => p.payment === "DINHEIRO")?.totalCents).toBe(4000);
    expect(byPay.find((p) => p.payment === "PIX")).toBeUndefined(); // a estornada era PIX

    const byOp = await revenueByOperator(acc, from, to);
    expect(byOp[0].totalCents).toBe(4000);

    const top = await topItems(acc, from, to, 5);
    expect(top[0].quantity).toBe(1); // não conta as 5 unidades da estornada
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

  it("commissionByProfessional soma o snapshot por profissional, ordena desc, exclui CANCELADA", async () => {
    const acc = await makeOwner();
    const p1 = await makePro(acc, "João");
    const p2 = await makePro(acc, "Maria");
    await createCommissionRule(acc, { professionalId: p1, percentBps: 4000 }); // 40%
    await createCommissionRule(acc, { professionalId: p2, percentBps: 5000 }); // 50%
    const item = await createCatalogItem(acc, { name: "Corte", priceCents: 10000 });

    // João: 1 comanda R$100 → base 10000, comissão 4000
    const j = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, j.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, j.id, { payment: "PIX", closedById: acc, professionalId: p1 });
    // Maria: 1 comanda R$100 → base 10000, comissão 5000
    const m = await openOrder(acc, { openedById: acc, customerName: "B" });
    await addItem(acc, m.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, m.id, { payment: "PIX", closedById: acc, professionalId: p2 });
    // João de novo, mas ESTORNADA → não conta
    const gone = await openOrder(acc, { openedById: acc, customerName: "C" });
    await addItem(acc, gone.id, { catalogItemId: item.id, quantity: 3 });
    await closeOrder(acc, gone.id, { payment: "PIX", closedById: acc, professionalId: p1 });
    await voidOrder(acc, gone.id, "engano", acc);

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const rows = await commissionByProfessional(acc, from, to);
    expect(rows.map((r) => r.professionalName)).toEqual(["Maria", "João"]); // comissão desc
    expect(rows.find((r) => r.professionalId === p1)).toMatchObject({ baseCents: 10000, commissionCents: 4000, itemCount: 1 });
    expect(rows.find((r) => r.professionalId === p2)).toMatchObject({ baseCents: 10000, commissionCents: 5000, itemCount: 1 });
  });

  it("comanda sem profissional não aparece no relatório de comissão", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Corte", priceCents: 5000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "PIX", closedById: acc });
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    expect(await commissionByProfessional(acc, from, to)).toEqual([]);
  });

  it("salesMargin agrega receita, custo e margem das comandas fechadas no período", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Bola", priceCents: 5000, kind: "PRODUTO", costCents: 2000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o.id, { catalogItemId: prod.id, quantity: 2 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const r = await salesMargin(acc, from, to);
    expect(r.revenueCents).toBe(10000);
    expect(r.costCents).toBe(4000);
    expect(r.marginCents).toBe(6000);
    expect(r.marginBps).toBe(6000); // 60%
    expect(r.withoutCostCount).toBe(0);
    expect(r.byItem[0]).toMatchObject({ name: "Bola", quantity: 2, costCents: 4000 });
  });

  it("salesMargin conta item sem custo como parcial (withoutCostCount)", async () => {
    const acc = await makeOwner();
    const semCusto = await createCatalogItem(acc, { name: "Bala", priceCents: 1000, kind: "PRODUTO" });
    const o = await openOrder(acc, { openedById: acc, customerName: "B" });
    await addItem(acc, o.id, { catalogItemId: semCusto.id, quantity: 3 });
    await closeOrder(acc, o.id, { payment: "PIX", closedById: acc });

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const r = await salesMargin(acc, from, to);
    expect(r.revenueCents).toBe(3000);
    expect(r.costCents).toBe(0);
    expect(r.withoutCostCount).toBe(3); // 3 unidades sem custo cadastrado
  });
});
