import { describe, it, expect } from "vitest";
import { buildAttendanceContext, renderActiveOffers, renderCatalogForAI } from "./attendance-context";

describe("buildAttendanceContext", () => {
  it("inclui persona, base e horário quando presentes", () => {
    const out = buildAttendanceContext({
      displayName: "Acme",
      persona: "descontraído",
      knowledgeBase: "Vendemos guarda-chuvas. Frete grátis acima de R$100.",
      businessHours: "Seg–Sex 9h–18h",
    });
    expect(out).toContain("Acme");
    expect(out).toContain("descontraído");
    expect(out).toContain("guarda-chuvas");
    expect(out).toContain("Seg–Sex 9h–18h");
  });

  it("omite seções ausentes sem quebrar", () => {
    const out = buildAttendanceContext({ displayName: null, persona: null, knowledgeBase: null, businessHours: null });
    expect(out).not.toContain("Persona:");
    expect(out).not.toContain("Horário");
    expect(typeof out).toBe("string");
  });
});

describe("renderActiveOffers", () => {
  it("renderiza id, nome, preço formatado e descrição", () => {
    const out = renderActiveOffers([
      { id: "off_abc", name: "Mentoria Fitness", priceCents: 19700, description: "Plano de treino" },
      { id: "off_def", name: "Consultoria Avulsa", priceCents: 9700, description: null },
    ]);
    expect(out).toContain("OFERTAS DISPONÍVEIS");
    expect(out).toContain("id=off_abc | Mentoria Fitness | R$ 197,00 | Plano de treino");
    expect(out).toContain("id=off_def | Consultoria Avulsa | R$ 97,00");
  });

  it("retorna string vazia sem ofertas", () => {
    expect(renderActiveOffers([])).toBe("");
  });
});

describe("renderCatalogForAI", () => {
  it("lista itens com preço; zero vira 'sob consulta'", () => {
    const out = renderCatalogForAI([
      { name: "X-Burguer", priceCents: 2500, kind: "PRODUTO" },
      { name: "Corte", priceCents: 0, kind: "SERVICO" },
    ]);
    expect(out).toContain("X-Burguer");
    expect(out).toContain("R$ 25,00");
    expect(out).toContain("Corte");
    expect(out).toMatch(/Corte.*sob consulta/);
  });
  it("vazio → string vazia", () => {
    expect(renderCatalogForAI([])).toBe("");
  });
  it("respeita o teto de itens", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}`, priceCents: 100, kind: "PRODUTO" as const }));
    const out = renderCatalogForAI(many, 40);
    expect(out.split("\n").filter((l) => l.startsWith("- ")).length).toBe(40);
  });
});
