import { describe, it, expect } from "vitest";
import { computeCartTotals } from "./cart";

describe("computeCartTotals", () => {
  it("soma itens; adiciona taxa só em delivery", () => {
    const lines = [
      { id: "a", priceCents: 1500, qty: 2 },
      { id: "b", priceCents: 500, qty: 1 },
    ];
    expect(computeCartTotals(lines, { mode: "RETIRADA", feeCents: 700 })).toMatchObject({
      subtotalCents: 3500,
      feeCents: 0,
      totalCents: 3500,
    });
    expect(computeCartTotals(lines, { mode: "DELIVERY", feeCents: 700 })).toMatchObject({
      subtotalCents: 3500,
      feeCents: 700,
      totalCents: 4200,
    });
  });

  it("carrinho vazio zera tudo", () => {
    expect(computeCartTotals([], { mode: "DELIVERY", feeCents: 700 })).toMatchObject({
      subtotalCents: 0,
      feeCents: 0,
      totalCents: 0,
    });
  });

  it("delivery sem itens não cobra taxa", () => {
    expect(computeCartTotals([], { mode: "DELIVERY", feeCents: 700 }).feeCents).toBe(0);
  });

  it("qty zero/negativa conta como 1 (mínimo)", () => {
    const lines = [{ id: "a", priceCents: 1000, qty: 0 }];
    expect(computeCartTotals(lines, { mode: "RETIRADA", feeCents: 0 }).subtotalCents).toBe(1000);
  });

  it("taxa negativa vira 0", () => {
    const lines = [{ id: "a", priceCents: 1000, qty: 1 }];
    expect(computeCartTotals(lines, { mode: "DELIVERY", feeCents: -100 }).feeCents).toBe(0);
  });
});
