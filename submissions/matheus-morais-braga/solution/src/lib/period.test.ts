// src/lib/period.test.ts
import { describe, it, expect } from "vitest";
import { monthRange, currentMonth } from "./period";

describe("monthRange", () => {
  it("'2026-06' -> [01/jun, 01/jul) em UTC", () => {
    const { from, to } = monthRange("2026-06");
    expect(from).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    expect(to).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });
  it("dezembro vira janeiro do ano seguinte", () => {
    const { from, to } = monthRange("2026-12");
    expect(from).toEqual(new Date("2026-12-01T00:00:00.000Z"));
    expect(to).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });
});

describe("currentMonth", () => {
  it("formata YYYY-MM com mês zero-padded", () => {
    expect(currentMonth(new Date("2026-03-09T12:00:00Z"))).toBe("2026-03");
  });
});
