import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder, voidOrder } from "./order.service";
import {
  openSession, addMovement, closeSession, getOpenSession,
  expectedCashCents, sessionSummary, listClosedSessions,
} from "./cash-session.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cash_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("expectedCashCents (puro)", () => {
  it("fundo + vendas + suprimentos − sangrias", () => {
    expect(expectedCashCents({ openingFloatCents: 10000, cashSalesCents: 5000, suprimentosCents: 2000, sangriasCents: 3000 })).toBe(14000);
  });
  it("sessão zerada = 0", () => {
    expect(expectedCashCents({ openingFloatCents: 0, cashSalesCents: 0, suprimentosCents: 0, sangriasCents: 0 })).toBe(0);
  });
  it("sangria pode deixar negativo (retirada além do que entrou)", () => {
    expect(expectedCashCents({ openingFloatCents: 1000, cashSalesCents: 0, suprimentosCents: 0, sangriasCents: 3000 })).toBe(-2000);
  });
});

describe("openSession", () => {
  it("abre com fundo de troco e fica ABERTA", async () => {
    const acc = await makeOwner();
    const s = await openSession(acc, acc, 10000);
    expect(s.status).toBe("ABERTA");
    expect(s.openingFloatCents).toBe(10000);
    expect(s.closedAt).toBeNull();
    expect((await getOpenSession(acc))?.id).toBe(s.id);
  });

  it("recusa segunda sessão ABERTA na mesma conta", async () => {
    const acc = await makeOwner();
    await openSession(acc, acc, 0);
    await expect(openSession(acc, acc, 0)).rejects.toThrow(/aberto/i);
  });

  it("contas diferentes têm sessões independentes", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await openSession(a, a, 0);
    const sb = await openSession(b, b, 0); // não colide com a de A
    expect(sb.status).toBe("ABERTA");
  });

  it("rejeita fundo negativo", async () => {
    const acc = await makeOwner();
    await expect(openSession(acc, acc, -1)).rejects.toThrow();
  });
});

describe("addMovement / closeSession", () => {
  it("registra sangria/suprimento em sessão ABERTA", async () => {
    const acc = await makeOwner();
    const s = await openSession(acc, acc, 10000);
    await addMovement(acc, s.id, "SUPRIMENTO", 5000, "reforço", acc);
    await addMovement(acc, s.id, "SANGRIA", 3000, "depósito", acc);
    expect(await prisma.cashMovement.count({ where: { sessionId: s.id } })).toBe(2);
  });

  it("recusa movimento de outra conta", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const s = await openSession(acc, acc, 0);
    await expect(addMovement(other, s.id, "SANGRIA", 100, null, other)).rejects.toThrow();
  });

  it("recusa movimento e valor não-positivo em sessão fechada", async () => {
    const acc = await makeOwner();
    const s = await openSession(acc, acc, 0);
    await expect(addMovement(acc, s.id, "SANGRIA", 0, null, acc)).rejects.toThrow();
    await closeSession(acc, s.id, acc, 0);
    await expect(addMovement(acc, s.id, "SANGRIA", 100, null, acc)).rejects.toThrow(/fechado/i);
  });

  it("fecha grava contado + fechador; refechar barra", async () => {
    const acc = await makeOwner();
    const s = await openSession(acc, acc, 10000);
    const closed = await closeSession(acc, s.id, acc, 12000);
    expect(closed.status).toBe("FECHADA");
    expect(closed.closingCountedCents).toBe(12000);
    expect(closed.closedById).toBe(acc);
    expect(closed.closedAt).toBeTruthy();
    expect(await getOpenSession(acc)).toBeNull();
    await expect(closeSession(acc, s.id, acc, 12000)).rejects.toThrow(/fechada/i);
  });
});

describe("sessionSummary — conferência derivada", () => {
  it("soma vendas em DINHEIRO das comandas da sessão; ignora Pix no esperado", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 5000 });
    const s = await openSession(acc, acc, 10000); // fundo R$100

    // comanda em dinheiro (entra no esperado). O carimbo do cashSessionId é da Task
    // 2.1 (closeOrder); aqui o vínculo é forçado p/ testar sessionSummary isolado.
    const o1 = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o1.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o1.id, { tenders: [{ method: "DINHEIRO", amountCents: 5000 }], closedById: acc });
    await prisma.order.update({ where: { id: o1.id }, data: { cashSessionId: s.id } });

    // comanda em Pix (informativo, NÃO entra no esperado em dinheiro)
    const o2 = await openOrder(acc, { openedById: acc, customerName: "B" });
    await addItem(acc, o2.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o2.id, { tenders: [{ method: "PIX", amountCents: 5000 }], closedById: acc });
    await prisma.order.update({ where: { id: o2.id }, data: { cashSessionId: s.id } });

    await addMovement(acc, s.id, "SANGRIA", 3000, "depósito", acc); // esperado cai

    const sum = await sessionSummary(acc, s.id);
    expect(sum.cashSalesCents).toBe(5000);
    expect(sum.salesByMethod.PIX).toBe(5000);
    expect(sum.sangriasCents).toBe(3000);
    expect(sum.expected).toBe(12000); // 10000 + 5000 − 3000
    expect(sum.counted).toBeNull(); // ainda aberta
    expect(sum.diff).toBeNull();
  });

  it("após fechar, expõe contado e diferença (sobra/falta)", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 4000 });
    const s = await openSession(acc, acc, 10000);
    const o = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o.id, { tenders: [{ method: "DINHEIRO", amountCents: 4000 }], closedById: acc });
    await prisma.order.update({ where: { id: o.id }, data: { cashSessionId: s.id } });
    // esperado = 10000 + 4000 = 14000; conta 13900 → falta 100
    await closeSession(acc, s.id, acc, 13900);
    const sum = await sessionSummary(acc, s.id);
    expect(sum.expected).toBe(14000);
    expect(sum.counted).toBe(13900);
    expect(sum.diff).toBe(-100); // falta
  });

  it("comanda estornada no turno sai do esperado em dinheiro", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 5000 });
    const s = await openSession(acc, acc, 10000); // fundo R$100

    // duas vendas em dinheiro na sessão; uma será estornada
    const o1 = await openOrder(acc, { openedById: acc, customerName: "Fica" });
    await addItem(acc, o1.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o1.id, { tenders: [{ method: "DINHEIRO", amountCents: 5000 }], closedById: acc });
    const o2 = await openOrder(acc, { openedById: acc, customerName: "Estornada" });
    await addItem(acc, o2.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o2.id, { tenders: [{ method: "DINHEIRO", amountCents: 5000 }], closedById: acc });

    // ambas carimbam a sessão (a estornada mantém tenders + cashSessionId no ledger)
    const before = await sessionSummary(acc, s.id);
    expect(before.cashSalesCents).toBe(10000);
    expect(before.expected).toBe(20000); // 10000 fundo + 10000 vendas

    await voidOrder(acc, o2.id, "valor errado", acc);

    const after = await sessionSummary(acc, s.id);
    expect(after.cashSalesCents).toBe(5000); // só a que ficou
    expect(after.expected).toBe(15000); // 10000 + 5000
  });

  it("comanda fora de sessão não entra na conferência", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Item", priceCents: 4000 });
    const s = await openSession(acc, acc, 0);
    const sum = await sessionSummary(acc, s.id);
    expect(sum.cashSalesCents).toBe(0);
    expect(sum.expected).toBe(0);
  });

  it("listClosedSessions traz só as FECHADAS da conta", async () => {
    const acc = await makeOwner();
    const s = await openSession(acc, acc, 0);
    expect(await listClosedSessions(acc)).toHaveLength(0);
    await closeSession(acc, s.id, acc, 0);
    const list = await listClosedSessions(acc);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(s.id);
  });
});
