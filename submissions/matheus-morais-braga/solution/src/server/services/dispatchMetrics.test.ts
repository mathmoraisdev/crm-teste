import { describe, it, expect } from "vitest";
import { estimateEtaMinutes } from "./dispatchMetrics";

describe("estimateEtaMinutes", () => {
  it("fila / vazão por minuto", () => {
    expect(estimateEtaMinutes(1000, 100)).toBe(10);
  });
  it("vazão 0 = null (sem chip vivo)", () => {
    expect(estimateEtaMinutes(1000, 0)).toBeNull();
  });
});
