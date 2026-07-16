import { describe, it, expect } from "vitest";
import { buildReceiptModel } from "./model";

const business = { name: "Barbearia Style", subtitle: "Seg–Sáb 9h–20h", width: 32 as const };
const order = {
  number: 42,
  id: "ckxyz123",
  customerName: "João",
  closedAt: new Date("2026-07-05T14:30:00-03:00"),
  payment: "DINHEIRO" as const,
  items: [
    { nameSnapshot: "Corte masculino", quantity: 1, unitPriceCents: 4000 },
    { nameSnapshot: "Barba", quantity: 2, unitPriceCents: 2500 },
  ],
};

describe("buildReceiptModel", () => {
  it("cabeçalho traz nome e nº do cupom", () => {
    const m = buildReceiptModel(order, business);
    expect(m.header.title).toBe("Barbearia Style");
    expect(m.header.docNumber).toBe("Cupom #42");
  });

  it("linhas somam qtd×preço e alinham o valor", () => {
    const m = buildReceiptModel(order, business);
    const barba = m.lines.find((l) => l.name.startsWith("Barba"));
    expect(barba?.totalCents).toBe(5000); // 2 × 2500
    // largura total respeita a coluna (32)
    expect(m.lines.every((l) => l.rendered.length <= 32)).toBe(true);
  });

  it("total do rodapé = soma das linhas", () => {
    const m = buildReceiptModel(order, business);
    expect(m.totals.totalCents).toBe(4000 + 5000);
  });

  it("cai no id curto quando number é null", () => {
    const m = buildReceiptModel({ ...order, number: null }, business);
    expect(m.header.docNumber).toBe("Comanda ckxyz123".slice(0, 20));
  });

  it("recibo simples: sem ajustes → summary vazio, sem troco, pagamento único", () => {
    const m = buildReceiptModel(order, business);
    expect(m.summary).toEqual([]);
    expect(m.change).toBeNull();
    expect(m.payments).toHaveLength(1);
    expect(m.payments[0].method).toBe("DINHEIRO");
    expect(m.payments[0].amountCents).toBeNull(); // legado: só o rótulo "Pagamento"
  });

  it("com ajustes: desdobra subtotal/desconto/taxa/gorjeta e ajusta o total", () => {
    const m = buildReceiptModel(
      { ...order, discountCents: 1500, surchargeCents: 850, tipCents: 500 },
      business,
    );
    const labels = m.summary.map((s) => s.label);
    expect(labels).toEqual(["Subtotal", "Desconto", "Taxa de serviço", "Gorjeta"]);
    // subtotal 9000; 9000−1500+850+500 = 8850
    expect(m.totals.totalCents).toBe(8850);
  });

  it("linha sem adicionais tem subLines vazio", () => {
    const m = buildReceiptModel(order, business);
    expect(m.lines.every((l) => Array.isArray(l.subLines) && l.subLines.length === 0)).toBe(true);
  });

  it("adicionais viram subLines (cosmético) e NÃO alteram o total", () => {
    const withMods = buildReceiptModel(
      { ...order, items: [
        { nameSnapshot: "X-Burger", quantity: 1, unitPriceCents: 3300,
          modifiers: [{ optionName: "Grande" }, { optionName: "Bacon" }] },
      ] },
      business,
    );
    const line = withMods.lines[0];
    expect(line.subLines).toHaveLength(2);
    expect(line.subLines.some((s) => s.includes("Grande"))).toBe(true);
    expect(line.subLines.some((s) => s.includes("Bacon"))).toBe(true);
    // subLines NÃO carregam valor à direita (cosméticas)
    expect(line.subLines.every((s) => !/\d,\d{2}/.test(s))).toBe(true);

    // total imutável: o MESMO item sem `modifiers` fecha o mesmo total
    const noMods = buildReceiptModel(
      { ...order, items: [{ nameSnapshot: "X-Burger", quantity: 1, unitPriceCents: 3300 }] },
      business,
    );
    expect(withMods.totals.totalCents).toBe(noMods.totals.totalCents);
    expect(withMods.totals.totalCents).toBe(3300);
  });

  it("multi-pagamento + troco: uma linha por tender e a linha de troco", () => {
    const m = buildReceiptModel(
      {
        ...order,
        changeCents: 150,
        tenders: [
          { method: "PIX", amountCents: 5000 },
          { method: "DINHEIRO", amountCents: 4150 },
        ],
      },
      business,
    );
    expect(m.payments.map((p) => p.method)).toEqual(["PIX", "DINHEIRO"]);
    expect(m.payments[0].amountCents).toBe(5000);
    expect(m.change?.cents).toBe(150);
  });
});
