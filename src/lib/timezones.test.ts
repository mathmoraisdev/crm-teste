import { describe, it, expect, vi } from "vitest";

// Mock determinístico do env — resolveTimezone cai em SCHEDULING_TIMEZONE quando
// o número não tem fuso. Isolado do ambiente real para o teste não depender de .env.
vi.mock("@/lib/env", () => ({ env: { SCHEDULING_TIMEZONE: "America/Sao_Paulo" } }));

import { BR_TIMEZONES, isValidBrTimezone, resolveTimezone } from "./timezones";

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
    expect(resolveTimezone("America/Porto_Velho")).toBe("America/Porto_Velho");
  });
  it("cai no default (SCHEDULING_TIMEZONE) quando ausente", () => {
    expect(resolveTimezone(null)).toBe("America/Sao_Paulo");
    expect(resolveTimezone(undefined)).toBe("America/Sao_Paulo");
    expect(resolveTimezone("")).toBe("America/Sao_Paulo");
  });
  it("cai no default quando o fuso é inválido", () => {
    expect(resolveTimezone("America/New_York")).toBe("America/Sao_Paulo");
  });
  it("nunca devolve null/vazio", () => {
    expect(resolveTimezone(null).length).toBeGreaterThan(0);
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
