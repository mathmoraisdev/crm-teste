import { describe, it, expect } from "vitest";
import { marginBps, marginCents, itemValueCents } from "./margin";

describe("margin", () => {
  it("marginCents = (preço − custo) × qtd, custo null → conta como 0", () => {
    expect(marginCents({ priceCents: 1000, costCents: 400, quantity: 2 })).toBe(1200);
    expect(marginCents({ priceCents: 1000, costCents: null, quantity: 1 })).toBe(1000);
  });
  it("marginBps = margem sobre a receita, em pontos-base (inteiro, arredondado)", () => {
    expect(marginBps({ revenueCents: 1000, costCents: 400 })).toBe(6000); // 60%
    expect(marginBps({ revenueCents: 0, costCents: 0 })).toBe(0);          // guarda div/0
    expect(marginBps({ revenueCents: 300, costCents: 100 })).toBe(6667);   // 66,67%
  });
  it("itemValueCents = saldo × custo (null → 0)", () => {
    expect(itemValueCents({ stockQty: 5, costCents: 250 })).toBe(1250);
    expect(itemValueCents({ stockQty: 5, costCents: null })).toBe(0);
    expect(itemValueCents({ stockQty: -2, costCents: 250 })).toBe(-500); // saldo negativo é permitido
  });
});
