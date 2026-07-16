import { describe, it, expect } from "vitest";
import { hourInTz, isWithinWindow } from "./sendWindow";

describe("isWithinWindow", () => {
  const opts = { startHour: 9, endHour: 18 };
  it("aceita horário dentro da janela comercial", () => {
    expect(isWithinWindow(9, opts)).toBe(true);
    expect(isWithinWindow(17, opts)).toBe(true);
  });
  it("rejeita antes do início e a partir do fim", () => {
    expect(isWithinWindow(8, opts)).toBe(false);
    expect(isWithinWindow(18, opts)).toBe(false);
    expect(isWithinWindow(23, opts)).toBe(false);
  });
});

describe("hourInTz", () => {
  it("extrai a hora no fuso informado de forma determinística", () => {
    // 2026-06-17T12:00:00Z → 09:00 em America/Sao_Paulo (UTC-3)
    const d = new Date("2026-06-17T12:00:00Z");
    expect(hourInTz(d, "America/Sao_Paulo")).toBe(9);
  });
});
