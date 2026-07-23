// src/lib/billing.test.ts
import { describe, it, expect } from "vitest";
import { accountActive, daysRemaining } from "./billing";

const NOW = new Date("2026-06-27T12:00:00Z");
const FUTURE = new Date("2026-07-10T12:00:00Z");
const PAST = new Date("2026-06-01T12:00:00Z");

describe("accountActive", () => {
  it("AUTO + data futura = ativo", () => {
    expect(accountActive({ billingOverride: "AUTO", accessUntil: FUTURE }, NOW)).toBe(true);
  });
  it("AUTO + data vencida = suspenso", () => {
    expect(accountActive({ billingOverride: "AUTO", accessUntil: PAST }, NOW)).toBe(false);
  });
  it("AUTO + sem data = suspenso", () => {
    expect(accountActive({ billingOverride: "AUTO", accessUntil: null }, NOW)).toBe(false);
  });
  it("SUSPENDED ganha da data futura (kill switch)", () => {
    expect(accountActive({ billingOverride: "SUSPENDED", accessUntil: FUTURE }, NOW)).toBe(false);
  });
  it("ACTIVE ganha da data vencida (cortesia)", () => {
    expect(accountActive({ billingOverride: "ACTIVE", accessUntil: PAST }, NOW)).toBe(true);
  });
  it("ACTIVE mesmo sem data = ativo", () => {
    expect(accountActive({ billingOverride: "ACTIVE", accessUntil: null }, NOW)).toBe(true);
  });
});

describe("daysRemaining", () => {
  it("conta dias inteiros para frente (arredonda p/ cima)", () => {
    expect(daysRemaining(FUTURE, NOW)).toBe(13);
  });
  it("data vencida = 0 (nunca negativo)", () => {
    expect(daysRemaining(PAST, NOW)).toBe(0);
  });
  it("sem data = null", () => {
    expect(daysRemaining(null, NOW)).toBe(null);
  });
});
