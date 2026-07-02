import { describe, it, expect } from "vitest";
import {
  applyTemplate,
  hasTextContent,
  type BusinessTemplate,
  type TemplateApplyTarget,
} from "./business-templates";

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
