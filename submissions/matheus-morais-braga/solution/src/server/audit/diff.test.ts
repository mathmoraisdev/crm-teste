import { describe, it, expect } from "vitest";
import { computeDiff } from "./diff";

describe("computeDiff", () => {
  it("retorna só os campos que mudaram", () => {
    const before = { name: "Ana", phone: "11", email: "a@a" };
    const after = { name: "Ana Paula", phone: "11" };
    expect(computeDiff(before, after, ["name", "phone", "email"])).toEqual({
      name: { from: "Ana", to: "Ana Paula" },
    });
  });

  it("ignora campos ausentes no patch (undefined != mudança)", () => {
    const before = { priceCents: 2000, active: true };
    const after = { priceCents: 2400 };
    expect(computeDiff(before, after, ["priceCents", "active"])).toEqual({
      priceCents: { from: 2000, to: 2400 },
    });
  });

  it("objeto vazio quando nada mudou", () => {
    const before = { name: "Ana" };
    expect(computeDiff(before, { name: "Ana" }, ["name"])).toEqual({});
  });
});
