import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, planLabel } from "./plans";

describe("PLAN_LIMITS", () => {
  it("define os três planos com os limites travados", () => {
    expect(PLAN_LIMITS.INICIAL).toMatchObject({ maxNumbers: 1, maxSeats: 2, campaigns: false });
    expect(PLAN_LIMITS.PROFISSIONAL).toMatchObject({ maxNumbers: 2, maxSeats: 5, campaigns: true });
    expect(PLAN_LIMITS.ESCALA).toMatchObject({ maxNumbers: 4, maxSeats: 10, campaigns: true });
  });
  it("planLabel devolve o rótulo PT-BR", () => {
    expect(planLabel("PROFISSIONAL")).toBe("Profissional");
    expect(planLabel(null)).toBe("—");
  });
});
