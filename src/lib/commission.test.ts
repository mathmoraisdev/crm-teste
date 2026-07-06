import { describe, it, expect } from "vitest";
import { pickCommissionRule, commissionForLine, type CommissionRuleLite } from "./commission";

const pct = (catalogItemId: string | null, bps: number): CommissionRuleLite =>
  ({ catalogItemId, percentBps: bps, fixedCents: null });
const fix = (catalogItemId: string | null, cents: number): CommissionRuleLite =>
  ({ catalogItemId, percentBps: null, fixedCents: cents });

describe("pickCommissionRule", () => {
  it("regra específica do serviço vence a padrão do profissional", () => {
    const rules = [pct(null, 3000), pct("svc-corte", 5000)];
    expect(pickCommissionRule(rules, "svc-corte")?.percentBps).toBe(5000);
  });
  it("cai na padrão (catalogItemId null) quando não há específica", () => {
    const rules = [pct(null, 3000), pct("svc-corte", 5000)];
    expect(pickCommissionRule(rules, "svc-barba")?.percentBps).toBe(3000);
  });
  it("item avulso (catalogItemId null na linha) usa só a padrão", () => {
    expect(pickCommissionRule([pct(null, 3000)], null)?.percentBps).toBe(3000);
  });
  it("sem regra aplicável → null", () => {
    expect(pickCommissionRule([pct("svc-x", 4000)], "svc-corte")).toBeNull();
    expect(pickCommissionRule([], "svc-corte")).toBeNull();
  });
});

describe("commissionForLine", () => {
  it("percentual sobre o bruto da linha (unit × qtd)", () => {
    // 40% de R$100,00 (10000c) × 1 = R$40,00
    expect(commissionForLine({ unitPriceCents: 10000, quantity: 1, rule: pct(null, 4000) })).toBe(4000);
    // 40% de R$50,00 × 2 = 40% de 10000 = 4000
    expect(commissionForLine({ unitPriceCents: 5000, quantity: 2, rule: pct(null, 4000) })).toBe(4000);
  });
  it("percentual arredonda a centavo (round, não trunca)", () => {
    // 33,33% de R$10,00 (1000c) = 333,3 → 333
    expect(commissionForLine({ unitPriceCents: 1000, quantity: 1, rule: pct(null, 3333) })).toBe(333);
  });
  it("fixo é POR UNIDADE (× quantidade)", () => {
    // R$10,00 por corte × 3 = R$30,00
    expect(commissionForLine({ unitPriceCents: 8000, quantity: 3, rule: fix(null, 1000) })).toBe(3000);
  });
  it("sem regra → 0", () => {
    expect(commissionForLine({ unitPriceCents: 10000, quantity: 1, rule: null })).toBe(0);
  });
  it("nunca negativa", () => {
    expect(commissionForLine({ unitPriceCents: 0, quantity: 1, rule: pct(null, 4000) })).toBe(0);
  });
});
