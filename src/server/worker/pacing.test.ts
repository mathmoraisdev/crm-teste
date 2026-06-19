import { describe, it, expect } from "vitest";
import { perChipDelayMs } from "./pacing";

describe("perChipDelayMs", () => {
  it("soma intervalo base + jitter determinístico (rand injetável)", () => {
    expect(perChipDelayMs(1500, 1000, () => 0)).toBe(1500);
    expect(perChipDelayMs(1500, 1000, () => 1)).toBe(2500);
  });
  it("intervalo 0 + jitter 0 = sem pausa (máximo)", () => {
    expect(perChipDelayMs(0, 0, () => 0.7)).toBe(0);
  });
});
