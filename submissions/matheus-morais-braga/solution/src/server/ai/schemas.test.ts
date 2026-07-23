import { describe, it, expect } from "vitest";
import {
  NEXT_ACTIONS,
  qualificationSchema,
  qualificationJsonSchema,
  slotChoiceSchema,
  slotChoiceJsonSchema,
  apptReplySchema,
  apptReplyJsonSchema,
} from "./schemas";

// Uma qualificação válida mínima — todos os campos opcionais como null.
const validQual = {
  interestLevel: "alto",
  painPoint: "fila manual de atendimento",
  segment: "varejo",
  isDecisionMaker: true,
  urgency: "alta",
  budget: null,
  preferredMeetingTime: null,
  email: "joao@empresa.com",
  score: 82,
  scoreJustification: "O lead demonstrou urgência na compra e confirmou ser o decisor.",
  summary: "Lead engajado, dor clara, decisor.",
  nextAction: "schedule_meeting",
};

describe("qualificationSchema (validação de saída do modelo)", () => {
  it("aceita uma qualificação bem-formada", () => {
    expect(qualificationSchema.safeParse(validQual).success).toBe(true);
  });

  it("aceita campos opcionais nulos (lead ainda frio)", () => {
    const cold = {
      ...validQual,
      interestLevel: null,
      painPoint: null,
      segment: null,
      isDecisionMaker: null,
      urgency: null,
      email: null,
      score: 10,
      nextAction: "ask_question",
    };
    expect(qualificationSchema.safeParse(cold).success).toBe(true);
  });

  it("rejeita score fora de 0–100", () => {
    expect(qualificationSchema.safeParse({ ...validQual, score: 101 }).success).toBe(false);
    expect(qualificationSchema.safeParse({ ...validQual, score: -1 }).success).toBe(false);
  });

  it("rejeita nextAction fora do enum", () => {
    expect(qualificationSchema.safeParse({ ...validQual, nextAction: "talvez" }).success).toBe(false);
  });

  it("aceita send_offer com offerId string ou null", () => {
    expect(NEXT_ACTIONS).toContain("send_offer");
    expect(
      qualificationSchema.safeParse({ ...validQual, nextAction: "send_offer", offerId: "off_abc" }).success,
    ).toBe(true);
    expect(qualificationSchema.safeParse({ ...validQual, offerId: null }).success).toBe(true);
    // offerId é opcional: ausência não invalida.
    expect(qualificationSchema.safeParse(validQual).success).toBe(true);
  });

  it("rejeita interestLevel inválido e summary ausente", () => {
    expect(qualificationSchema.safeParse({ ...validQual, interestLevel: "altíssimo" }).success).toBe(false);
    const { summary, ...noSummary } = validQual;
    void summary;
    expect(qualificationSchema.safeParse(noSummary).success).toBe(false);
  });

  it("rejeita qualificação sem scoreJustification", () => {
    const { scoreJustification, ...noJustification } = validQual;
    void scoreJustification;
    expect(qualificationSchema.safeParse(noJustification).success).toBe(false);
  });

  it("aceita scoreJustification como string não-vazia", () => {
    expect(
      qualificationSchema.safeParse({
        ...validQual,
        scoreJustification: "Lead pediu proposta imediata, sinal forte de intenção de compra.",
      }).success,
    ).toBe(true);
  });
});

describe("slotChoiceSchema", () => {
  it("aceita escolha confiante e indefinida", () => {
    expect(slotChoiceSchema.safeParse({ chosenIndex: 2, confident: true }).success).toBe(true);
    expect(slotChoiceSchema.safeParse({ chosenIndex: null, confident: false }).success).toBe(true);
  });

  it("rejeita índice não-inteiro", () => {
    expect(slotChoiceSchema.safeParse({ chosenIndex: 1.5, confident: true }).success).toBe(false);
  });
});

/**
 * O JSON Schema (contrato da tool, força o formato na saída do modelo) e o zod
 * (valida em runtime) são espelhos mantidos à mão. Estes testes falham se um
 * lado derivar do outro — o bug mais traiçoeiro nesta camada.
 */
describe("espelho zod ↔ JSON Schema", () => {
  it("qualification: required do JSON Schema == chaves do zod", () => {
    const zodKeys = Object.keys(qualificationSchema.shape).sort();
    const jsonRequired = [...qualificationJsonSchema.required].sort();
    expect(jsonRequired).toEqual(zodKeys);
  });

  it("qualification: enum de nextAction == NEXT_ACTIONS", () => {
    expect([...qualificationJsonSchema.properties.nextAction.enum]).toEqual([...NEXT_ACTIONS]);
  });

  it("slotChoice: required do JSON Schema == chaves do zod", () => {
    const zodKeys = Object.keys(slotChoiceSchema.shape).sort();
    const jsonRequired = [...slotChoiceJsonSchema.required].sort();
    expect(jsonRequired).toEqual(zodKeys);
  });
});

describe("apptReplySchema", () => {
  it("aceita intents válidos com confiança", () => {
    expect(apptReplySchema.safeParse({ intent: "confirm", confident: true }).success).toBe(true);
    expect(apptReplySchema.safeParse({ intent: "decline", confident: false }).success).toBe(true);
    expect(apptReplySchema.safeParse({ intent: "reschedule", confident: true }).success).toBe(true);
    expect(apptReplySchema.safeParse({ intent: "unclear", confident: false }).success).toBe(true);
  });

  it("rejeita intent fora do enum", () => {
    expect(apptReplySchema.safeParse({ intent: "talvez", confident: true }).success).toBe(false);
  });

  it("zod e JSON Schema declaram as mesmas chaves obrigatórias", () => {
    const zodKeys = Object.keys(apptReplySchema.shape).sort();
    const jsonRequired = [...apptReplyJsonSchema.required].sort();
    expect(zodKeys).toEqual(jsonRequired);
  });
});
