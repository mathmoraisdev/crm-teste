import { describe, it, expect } from "vitest";
import { typingDelayMs } from "./humanize";

describe("typingDelayMs", () => {
  const opts = { msPerChar: 50, maxMs: 9000 };
  it("cresce com o tamanho do texto", () => {
    // jitter fixo em 0 p/ determinismo
    expect(typingDelayMs(10, opts, () => 0)).toBe(500);
    expect(typingDelayMs(40, opts, () => 0)).toBe(2000);
  });
  it("respeita o teto", () => {
    expect(typingDelayMs(1000, opts, () => 0)).toBe(9000);
  });
  it("soma jitter aleatório", () => {
    // rand=1 → soma o máximo de jitter (até 30% do base)
    expect(typingDelayMs(10, opts, () => 1)).toBe(650); // 500 + 30%
  });
});
