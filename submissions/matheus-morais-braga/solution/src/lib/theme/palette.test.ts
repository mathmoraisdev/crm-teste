import { describe, it, expect } from "vitest";
import { DEFAULT_PALETTE, paletteToCssVars, BRAND_STOPS } from "./palette";

describe("paleta de marca", () => {
  it("tem exatamente as 11 paradas do Tailwind", () => {
    expect(Object.keys(DEFAULT_PALETTE)).toEqual(BRAND_STOPS.map(String));
  });

  it("cada parada é 'R G B' com canais 0–255", () => {
    for (const v of Object.values(DEFAULT_PALETTE)) {
      const parts = v.split(" ").map(Number);
      expect(parts).toHaveLength(3);
      for (const c of parts) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(255);
    }
  });

  it("gera as linhas CSS de variáveis a partir da paleta", () => {
    const css = paletteToCssVars(DEFAULT_PALETTE);
    expect(css).toContain("--brand-500: 14 164 107;");
    expect(css).toContain("--brand-950: 10 27 20;");
  });

  it("o default 500 corresponde ao verde primário atual (#0EA46B)", () => {
    expect(DEFAULT_PALETTE["500"]).toBe("14 164 107");
  });
});
