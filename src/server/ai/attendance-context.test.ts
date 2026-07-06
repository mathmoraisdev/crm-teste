import { describe, it, expect } from "vitest";
import {
  buildAttendanceContext,
  renderActiveOffers,
  renderCatalogForAI,
  renderCatalogForTools,
} from "./attendance-context";

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

  it("marca INDISPONÍVEL quando trackStock e estoque <= 0", () => {
    const out = renderCatalogForAI([
      { name: "Camiseta P", priceCents: 5000, kind: "PRODUTO", trackStock: true, stockQty: 0 },
    ]);
    expect(out).toMatch(/Camiseta P.*R\$ 50,00.*INDISPON[IÍ]VEL/i);
  });

  it("marca INDISPONÍVEL também com estoque negativo", () => {
    const out = renderCatalogForAI([
      { name: "Camiseta M", priceCents: 5000, kind: "PRODUTO", trackStock: true, stockQty: -3 },
    ]);
    expect(out).toMatch(/Camiseta M.*INDISPON[IÍ]VEL/i);
  });

  it("NÃO marca quando há estoque", () => {
    const out = renderCatalogForAI([
      { name: "Camiseta G", priceCents: 5000, kind: "PRODUTO", trackStock: true, stockQty: 7 },
    ]);
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });

  it("NÃO marca quando trackStock é false (mesmo com stockQty 0)", () => {
    const out = renderCatalogForAI([
      { name: "Corte de Cabelo", priceCents: 4000, kind: "SERVICO", trackStock: false, stockQty: 0 },
    ]);
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });

  it("NÃO expõe a quantidade numérica", () => {
    const out = renderCatalogForAI([
      { name: "Boné", priceCents: 3000, kind: "PRODUTO", trackStock: true, stockQty: 42 },
    ]);
    expect(out).not.toContain("42");
  });

  it("itens sem campos de estoque continuam funcionando (retrocompat)", () => {
    const out = renderCatalogForAI([{ name: "Combo", priceCents: 2500, kind: "PRODUTO" }]);
    expect(out).toContain("Combo");
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });
});

describe("renderCatalogForTools", () => {
  it("expõe id, nome, preço e saldo de estoque", () => {
    const out = renderCatalogForTools([
      { id: "ci_1", name: "X-Burguer", priceCents: 2500, kind: "PRODUTO", trackStock: true, stockQty: 12 },
    ]);
    expect(out).toContain("id=ci_1");
    expect(out).toContain("X-Burguer");
    expect(out).toContain("R$ 25,00");
    expect(out).toContain("estoque=12");
  });

  it("item sem preço = 'sob consulta'", () => {
    const out = renderCatalogForTools([{ id: "ci_2", name: "Corte", priceCents: 0, kind: "SERVICO" }]);
    expect(out).toMatch(/id=ci_2.*sob consulta/);
  });

  it("sem controle de estoque → estoque=— e nunca INDISPONÍVEL", () => {
    const out = renderCatalogForTools([
      { id: "ci_3", name: "Consultoria", priceCents: 9700, kind: "SERVICO", trackStock: false, stockQty: 0 },
    ]);
    expect(out).toContain("estoque=—");
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });

  it("estoque <= 0 com trackStock → INDISPONÍVEL", () => {
    const out = renderCatalogForTools([
      { id: "ci_4", name: "Boné", priceCents: 3000, kind: "PRODUTO", trackStock: true, stockQty: 0 },
    ]);
    expect(out).toMatch(/id=ci_4.*estoque=0.*INDISPON[IÍ]VEL/);
  });

  it("NÃO trunca em 40 (lista de 60 itens sai inteira)", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `ci_${i}`,
      name: `Item ${i}`,
      priceCents: 100,
      kind: "PRODUTO" as const,
    }));
    const out = renderCatalogForTools(many);
    expect(out.split("\n").length).toBe(60);
  });

  it("vazio → string vazia", () => {
    expect(renderCatalogForTools([])).toBe("");
  });
});
