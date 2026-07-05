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
});
