import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, planLabel } from "./plans";

describe("PLAN_LIMITS", () => {
  it("define os três planos com os limites travados", () => {
    expect(PLAN_LIMITS.INICIAL).toMatchObject({ maxNumbers: 1, maxSeats: 2, maxContacts: 1000, campaigns: false });
    expect(PLAN_LIMITS.PROFISSIONAL).toMatchObject({ maxNumbers: 2, maxSeats: 5, maxContacts: 5000, campaigns: true });
    expect(PLAN_LIMITS.ESCALA).toMatchObject({ maxNumbers: 4, maxSeats: 10, maxContacts: 25000, campaigns: true });
  });
  it("define a cota mensal de IA por plano", () => {
    expect(PLAN_LIMITS.INICIAL.aiMonthlyQuota).toBe(4000);
    expect(PLAN_LIMITS.PROFISSIONAL.aiMonthlyQuota).toBe(10000);
    expect(PLAN_LIMITS.ESCALA.aiMonthlyQuota).toBe(24000);
  });
  it("nenhum plano libera modelo avançado na chave da plataforma (strong só via BYOK)", () => {
    expect(PLAN_LIMITS.INICIAL.allowStrongModel).toBe(false);
    expect(PLAN_LIMITS.PROFISSIONAL.allowStrongModel).toBe(false);
    expect(PLAN_LIMITS.ESCALA.allowStrongModel).toBe(false);
  });
  it("só PROFISSIONAL e ESCALA liberam vendas (funil de pagamento)", () => {
    expect(PLAN_LIMITS.INICIAL.sales).toBe(false);
    expect(PLAN_LIMITS.PROFISSIONAL.sales).toBe(true);
    expect(PLAN_LIMITS.ESCALA.sales).toBe(true);
  });
  it("planLabel devolve o rótulo PT-BR", () => {
    expect(planLabel("PROFISSIONAL")).toBe("Profissional");
    expect(planLabel(null)).toBe("—");
  });
});
