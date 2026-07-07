import { describe, it, expect } from "vitest";
import {
  applyTemplate,
  hasTextContent,
  catalogSeedItems,
  getTemplate,
  BUSINESS_TEMPLATES,
  CATEGORY_LABEL,
  type BusinessCategory,
  type BusinessTemplate,
  type TemplateApplyTarget,
} from "./business-templates";
import { PIPELINE_ORDER } from "./leadStatus";

const DUMMY: BusinessTemplate = {
  id: "dummy",
  category: "outro",
  label: "Dummy",
  blurb: "teste",
  persona: "persona-do-modelo",
  businessHours: "Seg–Sex 9h–18h",
  knowledgeBase: "base-do-modelo [preencha]",
  customInstructions: "instr-do-modelo",
  suggested: { autoReply: true, qualify: true, schedule: true, sales: true },
};

const EMPTY: TemplateApplyTarget = {
  persona: "",
  businessHours: "",
  knowledgeBase: "",
  customInstructions: "",
  autoReplyEnabled: false,
  qualifyEnabled: false,
  scheduleEnabled: false,
  salesEnabled: false,
};

const ALLOW_ALL = { qualify: true, schedule: true, sales: true };

describe("applyTemplate", () => {
  it("preenche campos vazios com o conteúdo do modelo", () => {
    const out = applyTemplate(EMPTY, DUMMY, { overwriteText: false, allow: ALLOW_ALL });
    expect(out.persona).toBe("persona-do-modelo");
    expect(out.knowledgeBase).toContain("[preencha]");
    expect(out.businessHours).toBe("Seg–Sex 9h–18h");
  });

  it("NÃO sobrescreve texto já preenchido quando overwriteText=false", () => {
    const cur = { ...EMPTY, persona: "meu texto" };
    const out = applyTemplate(cur, DUMMY, { overwriteText: false, allow: ALLOW_ALL });
    expect(out.persona).toBe("meu texto");
    expect(out.knowledgeBase).toBe("base-do-modelo [preencha]"); // vazio → preenche
  });

  it("sobrescreve tudo quando overwriteText=true", () => {
    const cur = { ...EMPTY, persona: "meu texto" };
    const out = applyTemplate(cur, DUMMY, { overwriteText: true, allow: ALLOW_ALL });
    expect(out.persona).toBe("persona-do-modelo");
  });

  it("clampa toggles sugeridos pelo que o plano permite", () => {
    const out = applyTemplate(EMPTY, DUMMY, {
      overwriteText: false,
      allow: { qualify: true, schedule: false, sales: false },
    });
    expect(out.qualifyEnabled).toBe(true);
    expect(out.scheduleEnabled).toBe(false); // sugerido mas não permitido
    expect(out.salesEnabled).toBe(false);
    expect(out.autoReplyEnabled).toBe(true); // autoReply não é gateado
  });

  it("nunca DESLIGA um toggle já ligado", () => {
    const cur = { ...EMPTY, scheduleEnabled: true };
    const off = { ...DUMMY, suggested: { autoReply: false, qualify: false, schedule: false, sales: false } };
    const out = applyTemplate(cur, off, { overwriteText: true, allow: ALLOW_ALL });
    expect(out.scheduleEnabled).toBe(true);
  });
});

describe("hasTextContent", () => {
  it("false quando tudo vazio/whitespace", () => {
    expect(hasTextContent(EMPTY)).toBe(false);
    expect(hasTextContent({ ...EMPTY, persona: "   " })).toBe(false);
  });
  it("true quando algum campo de texto tem conteúdo", () => {
    expect(hasTextContent({ ...EMPTY, knowledgeBase: "x" })).toBe(true);
  });
});

describe("catálogo BUSINESS_TEMPLATES", () => {
  it("tem ids únicos e em kebab-case", () => {
    const ids = BUSINESS_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("todo modelo tem campos obrigatórios não-vazios e categoria válida", () => {
    for (const t of BUSINESS_TEMPLATES) {
      expect(t.label.trim()).not.toBe("");
      expect(t.blurb.trim()).not.toBe("");
      expect(t.persona.trim()).not.toBe("");
      expect(t.knowledgeBase.trim()).not.toBe("");
      expect(CATEGORY_LABEL[t.category as BusinessCategory]).toBeDefined();
    }
  });
});

describe("catálogo — invariantes de produção", () => {
  it("customInstructions e businessHours são não-vazios em todo modelo", () => {
    for (const t of BUSINESS_TEMPLATES) {
      expect(t.customInstructions.trim(), `customInstructions vazio em ${t.id}`).not.toBe("");
      expect(t.businessHours.trim(), `businessHours vazio em ${t.id}`).not.toBe("");
    }
  });

  it("labels são únicos (evita ambiguidade no seletor)", () => {
    const labels = BUSINESS_TEMPLATES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("suggested tem os 4 toggles como booleanos", () => {
    for (const t of BUSINESS_TEMPLATES) {
      for (const key of ["autoReply", "qualify", "schedule", "sales"] as const) {
        expect(typeof t.suggested[key], `${key} não booleano em ${t.id}`).toBe("boolean");
      }
    }
  });

  it("knowledgeBase é estruturado (≥ 4 linhas com conteúdo)", () => {
    for (const t of BUSINESS_TEMPLATES) {
      const lines = t.knowledgeBase.split("\n").filter((l) => l.trim());
      expect(lines.length, `knowledgeBase raso em ${t.id}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("toda categoria do CATEGORY_LABEL tem ao menos um modelo", () => {
    const used = new Set(BUSINESS_TEMPLATES.map((t) => t.category));
    for (const cat of Object.keys(CATEGORY_LABEL) as BusinessCategory[]) {
      expect(used.has(cat), `categoria sem modelo: ${cat}`).toBe(true);
    }
  });
});

describe("catalogSeedItems", () => {
  it("barbearia: extrai serviços da seção, sem preço/placeholder", () => {
    const tpl = getTemplate("barbearia")!;
    const items = catalogSeedItems(tpl);
    const names = items.map((i) => i.name);
    expect(names).toContain("Corte");
    expect(names).toContain("Barba");
    expect(names).toContain("Corte + barba"); // parêntese "(combo)" removido
    expect(items.every((i) => i.kind === "SERVICO")).toBe(true);
    // nenhum item vem com "R$", ":" ou placeholder "["
    expect(names.every((n) => !/[:\[]|R\$/.test(n))).toBe(true);
  });

  it("varejo (ótica): itens de lista inline com '·' viram PRODUTO", () => {
    const tpl = getTemplate("otica")!;
    const names = catalogSeedItems(tpl).map((i) => i.name);
    expect(names).toContain("Armações");
    expect(names).toContain("Óculos de sol");
    expect(catalogSeedItems(tpl).every((i) => i.kind === "PRODUTO")).toBe(true);
  });

  it("modelo só com placeholder (advocacia) não gera itens", () => {
    const tpl = getTemplate("advocacia")!;
    expect(catalogSeedItems(tpl)).toHaveLength(0);
  });

  it("nunca lança e não repete nomes em nenhum modelo", () => {
    for (const t of BUSINESS_TEMPLATES) {
      const items = catalogSeedItems(t);
      const keys = items.map((i) => i.name.toLowerCase());
      expect(new Set(keys).size, `nomes duplicados em ${t.id}`).toBe(keys.length);
    }
  });

  it("a maioria dos modelos gera ao menos 1 item", () => {
    const withItems = BUSINESS_TEMPLATES.filter((t) => catalogSeedItems(t).length > 0);
    expect(withItems.length).toBeGreaterThan(BUSINESS_TEMPLATES.length / 2);
  });
});

describe("customFieldsPreset", () => {
  const withPreset = BUSINESS_TEMPLATES.filter((t) => t.customFieldsPreset?.length);

  it("todo item de preset é bem-formado (scope/label/type)", () => {
    for (const t of withPreset) {
      for (const f of t.customFieldsPreset!) {
        expect(["ORDER", "ORDER_ITEM", "PRODUCT"], `scope inválido em ${t.id}`).toContain(f.scope);
        expect(["TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"], `type inválido em ${t.id}`).toContain(f.type);
        expect(f.label.trim(), `label vazio em ${t.id}`).not.toBe("");
        if (f.type === "SELECT") expect(f.options?.length, `SELECT sem options em ${t.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("labels do preset são únicos dentro do mesmo escopo (evita colisão de key)", () => {
    for (const t of withPreset) {
      const keys = t.customFieldsPreset!.map((f) => `${f.scope}|${f.label.toLowerCase()}`);
      expect(new Set(keys).size, `labels colidem em ${t.id}`).toBe(keys.length);
    }
  });

  it("cobre as verticais de alto valor do roadmap", () => {
    const ids = new Set(withPreset.map((t) => t.id));
    for (const id of ["oficina-mecanica", "otica", "imobiliaria", "restaurante-delivery", "clinica-veterinaria", "petshop-produtos"]) {
      expect(ids.has(id), `sem customFieldsPreset: ${id}`).toBe(true);
    }
  });
});

describe("suggestedOffers", () => {
  const withOffers = BUSINESS_TEMPLATES.filter((t) => t.suggestedOffers?.length);

  it("todo item tem name não-vazio", () => {
    for (const t of withOffers)
      for (const o of t.suggestedOffers!) expect(o.name.trim(), `oferta sem nome em ${t.id}`).not.toBe("");
  });

  it("names únicos dentro do template (seed é idempotente por nome)", () => {
    for (const t of withOffers) {
      const names = t.suggestedOffers!.map((o) => o.name.toLowerCase());
      expect(new Set(names).size, `ofertas duplicadas em ${t.id}`).toBe(names.length);
    }
  });

  it("cobre ramos com sales=true (onde oferta faz sentido)", () => {
    const salesTemplates = BUSINESS_TEMPLATES.filter((t) => t.suggested.sales);
    const covered = salesTemplates.filter((t) => t.suggestedOffers?.length);
    expect(covered.length, "nenhum ramo de venda tem suggestedOffers").toBeGreaterThan(0);
  });
});

describe("pipelineLabels do template", () => {
  it("só usa chaves de LeadStatus válidas e rótulos não-vazios", () => {
    const valid = new Set(PIPELINE_ORDER);
    for (const t of BUSINESS_TEMPLATES.filter((x) => x.pipelineLabels)) {
      for (const [k, v] of Object.entries(t.pipelineLabels!)) {
        expect(valid.has(k as (typeof PIPELINE_ORDER)[number]), `chave inválida em ${t.id}: ${k}`).toBe(true);
        expect(String(v).trim(), `rótulo vazio em ${t.id}`).not.toBe("");
      }
    }
  });
});

describe("catalogPreset (estruturado)", () => {
  it("quando o template tem catalogPreset, catalogSeedItems usa-o (nomes exatos)", () => {
    for (const t of BUSINESS_TEMPLATES.filter((x) => x.catalogPreset?.length)) {
      expect(catalogSeedItems(t).map((i) => i.name), `nomes divergem em ${t.id}`).toEqual(
        t.catalogPreset!.map((p) => p.name),
      );
    }
  });

  it("preço do preset (quando informado) é inteiro >= 0", () => {
    for (const t of BUSINESS_TEMPLATES.filter((x) => x.catalogPreset?.length)) {
      for (const p of t.catalogPreset!) {
        if (p.priceCents !== undefined) {
          expect(Number.isInteger(p.priceCents), `preço não-inteiro em ${t.id}`).toBe(true);
          expect(p.priceCents, `preço negativo em ${t.id}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("sem catalogPreset, a heurística segue valendo (salao-beleza scrape)", () => {
    const names = catalogSeedItems(getTemplate("salao-beleza")!).map((i) => i.name);
    expect(names.length).toBeGreaterThan(0);
  });

  it("revenda-veiculos e imobiliaria têm ficha técnica (PRODUCT)", () => {
    for (const id of ["revenda-veiculos", "imobiliaria"]) {
      const tpl = BUSINESS_TEMPLATES.find((t) => t.id === id)!;
      const prod = (tpl.customFieldsPreset ?? []).filter((f) => f.scope === "PRODUCT");
      expect(prod.length).toBeGreaterThan(0);
    }
  });
});
