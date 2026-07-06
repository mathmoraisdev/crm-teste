import { describe, it, expect } from "vitest";
import { THEME_PRESETS, presetById, presetForCategory } from "./presets";
import { BUSINESS_TEMPLATES, type BusinessCategory } from "@/lib/business-templates";

describe("presets de tema", () => {
  it("toda palette tem as 11 paradas no formato 'R G B'", () => {
    const stops = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
    for (const p of THEME_PRESETS) {
      for (const s of stops) {
        const v = (p.palette as Record<string, string>)[s];
        expect(v, `${p.id} sem parada ${s}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
    }
  });

  it("ids únicos", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda categoria que TEM modelo de negócio tem um preset dedicado (sem cair no verde)", () => {
    const usedCats = new Set<BusinessCategory>(BUSINESS_TEMPLATES.map((t) => t.category));
    for (const cat of usedCats) {
      const p = presetForCategory(cat);
      expect(p.category, `categoria sem preset dedicado: ${cat}`).toBe(cat);
    }
  });

  it("presetById encontra pelo id e devolve null para desconhecido", () => {
    expect(presetById(THEME_PRESETS[0].id)).toBe(THEME_PRESETS[0]);
    expect(presetById("nao-existe")).toBeNull();
  });
});
