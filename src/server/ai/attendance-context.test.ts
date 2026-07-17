import { describe, it, expect } from "vitest";
import {
  buildAttendanceContext,
  buildNowBlock,
  renderActiveOffers,
  renderCatalogForAI,
  renderCatalogForTools,
  renderMediaAssetsForAI,
  renderSystemPromptOverride,
} from "./attendance-context";

describe("buildAttendanceContext", () => {
  it("inclui persona, base, horário e endereço quando presentes", () => {
    const out = buildAttendanceContext({
      displayName: "Acme",
      persona: "descontraído",
      knowledgeBase: "Vendemos guarda-chuvas. Frete grátis acima de R$100.",
      businessHours: "Seg–Sex 9h–18h",
      businessAddress: "Rua das Flores, 123 — Centro",
    });
    expect(out).toContain("Acme");
    expect(out).toContain("descontraído");
    expect(out).toContain("guarda-chuvas");
    expect(out).toContain("Seg–Sex 9h–18h");
    expect(out).toContain("Rua das Flores, 123 — Centro");
  });

  it("omite seções ausentes sem quebrar", () => {
    const out = buildAttendanceContext({
      displayName: null,
      persona: null,
      knowledgeBase: null,
      businessHours: null,
      businessAddress: null,
    });
    expect(out).not.toContain("Persona:");
    expect(out).not.toContain("Horário");
    expect(out).not.toContain("Endereço");
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

  it("anexa os grupos de adicionais com preço (delta 0 não mostra preço)", () => {
    const out = renderCatalogForAI([
      { name: "Burger", priceCents: 2000, kind: "PRODUTO", modifierGroups: [
        { name: "Tamanho", options: [{ name: "Média", priceDeltaCents: 0 }, { name: "Grande", priceDeltaCents: 800 }] },
        { name: "Extras", options: [{ name: "Bacon", priceDeltaCents: 500 }] },
      ] },
    ]);
    expect(out).toMatch(/Tamanho: Média, Grande \(\+R\$ 8,00\)/);
    expect(out).toContain("Extras: Bacon (+R$ 5,00)");
  });

  it("item sem grupos não ganha ' | opções:'", () => {
    const out = renderCatalogForAI([{ name: "Suco", priceCents: 800, kind: "PRODUTO" }]);
    expect(out).not.toContain("opções");
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

  it("inclui a ficha técnica (specs) quando presente", () => {
    const out = renderCatalogForTools([
      {
        id: "abc",
        name: "Onix 2019",
        kind: "PRODUTO",
        priceCents: 5490000,
        trackStock: true,
        stockQty: 1,
        customFields: { ano: 2019, cor: "Prata" },
      },
    ]);
    expect(out).toContain("Onix 2019");
    expect(out).toContain("ano: 2019");
    expect(out).toContain("cor: Prata");
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

  it("anexa os grupos de adicionais ao item da tool", () => {
    const out = renderCatalogForTools([
      { id: "ci_9", name: "Pizza", priceCents: 3000, kind: "PRODUTO", modifierGroups: [
        { name: "Borda", options: [{ name: "Catupiry", priceDeltaCents: 700 }] },
      ] },
    ]);
    expect(out).toContain("id=ci_9");
    expect(out).toContain("opções: Borda: Catupiry (+R$ 7,00)");
  });
});

describe("renderMediaAssetsForAI", () => {
  it("lista assetId + label", () => {
    const out = renderMediaAssetsForAI([
      { id: "ma_1", label: "cardápio" },
      { id: "ma_2", label: "tabela de preços" },
    ]);
    expect(out).toContain("MÍDIAS DISPONÍVEIS");
    expect(out).toContain("assetId=ma_1 | cardápio");
    expect(out).toContain("assetId=ma_2 | tabela de preços");
  });
  it("vazio → string vazia", () => {
    expect(renderMediaAssetsForAI([])).toBe("");
  });
});

describe("buildNowBlock", () => {
  // 2026-07-17T14:35:00Z → 11:35 em São Paulo (UTC−3) e 10:35 em Porto Velho (UTC−4).
  // Mesmo instante, horas diferentes — prova que o fuso do número é respeitado.
  const NOW = new Date("2026-07-17T14:35:00.000Z");

  it("mostra data, hora, dia da semana e fuso no fuso do número", () => {
    const out = buildNowBlock({ tz: "America/Porto_Velho", now: NOW });
    expect(out).toContain("Data/hora atual: 17/07/2026 10:35");
    expect(out).toContain("Fuso horário: America/Porto_Velho");
    expect(out).toContain("sexta-feira");
  });

  it("respeita o fuso — mesma hora Z dá horas diferentes por número", () => {
    const sp = buildNowBlock({ tz: "America/Sao_Paulo", now: NOW });
    const ro = buildNowBlock({ tz: "America/Porto_Velho", now: NOW });
    expect(sp).toContain("11:35");
    expect(ro).toContain("10:35");
  });

  it("inclui a linha de expediente quando informada", () => {
    const out = buildNowBlock({
      tz: "America/Porto_Velho",
      businessHours: "Seg–Sex, 09:00–15:00",
      now: NOW,
    });
    expect(out).toContain("Expediente: Seg–Sex, 09:00–15:00");
  });

  it("omite a linha de expediente quando ausente", () => {
    const out = buildNowBlock({ tz: "America/Porto_Velho", now: NOW });
    expect(out).not.toContain("Expediente");
  });
});

describe("renderSystemPromptOverride", () => {
  const NOW = new Date("2026-07-17T14:35:00.000Z");

  it("substitui o alias legado {{DATA_E_HORA_DO_SISTEMA}} pela data/hora real", () => {
    const out = renderSystemPromptOverride(
      "O horário atual é: {{DATA_E_HORA_DO_SISTEMA}}",
      { tz: "America/Porto_Velho", now: NOW },
    );
    expect(out).not.toContain("{{DATA_E_HORA_DO_SISTEMA}}");
    expect(out).toContain("17/07/2026 10:35");
  });

  it("substitui {{HORA_ATUAL}}, {{FUSO}} e {{EXPEDIENTE}}", () => {
    const out = renderSystemPromptOverride(
      "Agora={{HORA_ATUAL}} Fuso={{FUSO}} Expediente={{EXPEDIENTE}}",
      { tz: "America/Porto_Velho", businessHours: "09–15", now: NOW },
    );
    expect(out).toContain("Agora=10:35");
    expect(out).toContain("Fuso=America/Porto_Velho");
    expect(out).toContain("Expediente=09–15");
  });

  it("expediente ausente vira string vazia no placeholder", () => {
    const out = renderSystemPromptOverride("Expediente:{{EXPEDIENTE}}", {
      tz: "America/Porto_Velho",
      now: NOW,
    });
    expect(out).toBe("Expediente:");
  });

  it("placeholders ausentes no template não alteram o texto", () => {
    const out = renderSystemPromptOverride("Texto sem placeholders.", {
      tz: "America/Porto_Velho",
      now: NOW,
    });
    expect(out).toBe("Texto sem placeholders.");
  });
});
