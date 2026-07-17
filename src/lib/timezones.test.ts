import { describe, it, expect } from "vitest";

import { BR_TIMEZONES, isValidBrTimezone, resolveTimezone } from "./timezones";

// Default passado pelo chamador server-side (tipicamente env.SCHEDULING_TIMEZONE).
const DEFAULT_TZ = "America/Sao_Paulo";

describe("isValidBrTimezone", () => {
  it("aceita fusos IANA brasileiros da lista", () => {
    expect(isValidBrTimezone("America/Porto_Velho")).toBe(true);
    expect(isValidBrTimezone("America/Sao_Paulo")).toBe(true);
    expect(isValidBrTimezone("America/Rio_Branco")).toBe(true);
  });
  it("rejeita null, vazio e fusos fora da lista", () => {
    expect(isValidBrTimezone(null)).toBe(false);
    expect(isValidBrTimezone("")).toBe(false);
    expect(isValidBrTimezone("America/New_York")).toBe(false);
    expect(isValidBrTimezone("America/Porto Velho")).toBe(false); // espaço não é _
  });
});

describe("resolveTimezone", () => {
  it("preserva um fuso válido", () => {
    expect(resolveTimezone("America/Porto_Velho", DEFAULT_TZ)).toBe("America/Porto_Velho");
  });
  it("cai no default quando ausente", () => {
    expect(resolveTimezone(null, DEFAULT_TZ)).toBe("America/Sao_Paulo");
    expect(resolveTimezone(undefined, DEFAULT_TZ)).toBe("America/Sao_Paulo");
    expect(resolveTimezone("", DEFAULT_TZ)).toBe("America/Sao_Paulo");
  });
  it("cai no default quando o fuso é inválido", () => {
    expect(resolveTimezone("America/New_York", DEFAULT_TZ)).toBe("America/Sao_Paulo");
  });
  it("nunca devolve null/vazio", () => {
    expect(resolveTimezone(null, DEFAULT_TZ).length).toBeGreaterThan(0);
  });
});

describe("BR_TIMEZONES", () => {
  it("contém os fusos brasileiros relevantes (inclui Porto Velho)", () => {
    const values = BR_TIMEZONES.map((t) => t.value);
    expect(values).toContain("America/Porto_Velho");
    expect(values).toContain("America/Sao_Paulo");
    expect(values).toContain("America/Rio_Branco");
  });
});
