import { describe, it, expect, beforeAll } from "vitest";

// provider.ts importa @/lib/env (lê DATABASE_URL na carga do módulo).
beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

describe("provider AiClient", () => {
  it("buildAiClient(openai) expõe generateText e forcedToolCall", async () => {
    const { buildAiClient } = await import("./provider");
    const ai = buildAiClient({ provider: "OPENAI", apiKey: "sk-test" });
    expect(typeof ai.generateText).toBe("function");
    expect(typeof ai.forcedToolCall).toBe("function");
  });

  it("buildAiClient(anthropic) expõe a mesma interface", async () => {
    const { buildAiClient } = await import("./provider");
    const ai = buildAiClient({ provider: "ANTHROPIC", apiKey: "sk-ant-test" });
    expect(typeof ai.generateText).toBe("function");
    expect(typeof ai.forcedToolCall).toBe("function");
  });

  it("MODELS expõe cheap/strong por provider", async () => {
    const { MODELS_BY_PROVIDER } = await import("./provider");
    expect(MODELS_BY_PROVIDER.OPENAI.strong).toBeTruthy();
    expect(MODELS_BY_PROVIDER.ANTHROPIC.strong).toContain("claude");
  });
});
