import { describe, it, expect } from "vitest";
import { modelTier, modelCreditWeight, AI_MODELS_BY_PROVIDER } from "./ai-models";

describe("modelTier", () => {
  it("classifica modelos avançados como strong", () => {
    expect(modelTier("gpt-4o")).toBe("strong");
    expect(modelTier("claude-opus-4-8")).toBe("strong");
    expect(modelTier("claude-sonnet-4-6")).toBe("strong");
  });
  it("classifica modelos econômicos como cheap", () => {
    expect(modelTier("gpt-4o-mini")).toBe("cheap");
    expect(modelTier("gpt-4.1-nano")).toBe("cheap");
    expect(modelTier("claude-haiku-4-5")).toBe("cheap");
  });
  it("null/vazio/desconhecido → cheap (padrão econômico seguro)", () => {
    expect(modelTier(null)).toBe("cheap");
    expect(modelTier("")).toBe("cheap");
    expect(modelTier("modelo-que-nao-existe")).toBe("cheap");
  });
});

describe("modelCreditWeight", () => {
  it("strong pesa 10, cheap pesa 1", () => {
    expect(modelCreditWeight("gpt-4o")).toBe(10);
    expect(modelCreditWeight("gpt-4o-mini")).toBe(1);
  });
  it("null/desconhecido → 1", () => {
    expect(modelCreditWeight(null)).toBe(1);
    expect(modelCreditWeight("xyz")).toBe(1);
  });
});

describe("AI_MODELS_BY_PROVIDER", () => {
  it("todo modelo do catálogo tem tier", () => {
    for (const list of Object.values(AI_MODELS_BY_PROVIDER)) {
      for (const m of list) expect(m.tier === "cheap" || m.tier === "strong").toBe(true);
    }
  });
});
