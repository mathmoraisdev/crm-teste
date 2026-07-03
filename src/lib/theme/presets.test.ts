import { describe, it, expect } from "vitest";
import { THEME_PRESETS, presetById, presetForCategory } from "./presets";
import { BRAND_STOPS } from "./palette";

describe("presets de tema", () => {
  it("todo preset tem as 11 paradas em 'R G B'", () => {
    for (const p of THEME_PRESETS) {
      expect(Object.keys(p.palette).sort()).toEqual(BRAND_STOPS.map(String).sort());
      for (const v of Object.values(p.palette)) {
        expect(v.split(" ").map(Number)).toHaveLength(3);
      }
    }
  });

  it("ids são únicos", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("presetById encontra e presetForCategory cai num default se a categoria não tem preset dedicado", () => {
    expect(presetById(THEME_PRESETS[0].id)).toBe(THEME_PRESETS[0]);
    expect(presetById("nao-existe")).toBeNull();
    expect(presetForCategory("beleza")).not.toBeNull(); // deve haver preset p/ beleza
    expect(presetForCategory("outro")).not.toBeNull(); // sempre devolve algo (fallback)
  });
});
