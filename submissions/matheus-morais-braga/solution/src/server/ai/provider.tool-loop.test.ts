import { describe, it, expect, beforeAll } from "vitest";
import type {
  AiClient,
  RunToolLoopOpts,
  RunToolLoopResult,
  ToolDef,
} from "./provider";

// provider.ts importa @/lib/env (lê DATABASE_URL na carga do módulo).
beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

/**
 * Fake AiClient roteirizado: executa os handlers REAIS passados em `opts.tools`
 * na ordem de `script`, respeitando `stop`. Fixa o CONTRATO de RunToolLoopResult
 * que o resto do plano consome; a impl real dos SDKs é 1.2/1.3.
 */
function scriptedClient(
  script: { call: string; args: unknown }[],
  finalText: string,
): AiClient {
  return {
    generateText: async () => {
      throw new Error("generateText não usado neste teste");
    },
    forcedToolCall: async () => {
      throw new Error("forcedToolCall não usado neste teste");
    },
    async runToolLoop(opts: RunToolLoopOpts): Promise<RunToolLoopResult> {
      const byName = new Map<string, ToolDef>(opts.tools.map((t) => [t.name, t]));
      const toolsUsed: string[] = [];
      for (const step of script) {
        const tool = byName.get(step.call);
        if (!tool) throw new Error(`tool inexistente no script: ${step.call}`);
        const res = await tool.handler(step.args);
        toolsUsed.push(step.call);
        if (res.stop) return { text: "", toolsUsed, stopped: true };
      }
      return { text: finalText, toolsUsed, stopped: false };
    },
  };
}

describe("runToolLoop — contrato do resultado", () => {
  it("propaga texto final e registra as tools usadas", async () => {
    const seen: unknown[] = [];
    const tools: ToolDef[] = [
      {
        name: "consultar_estoque",
        description: "consulta",
        jsonSchema: { type: "object" },
        handler: async (args) => {
          seen.push(args);
          return { content: "id=1 | X | R$ 10,00" };
        },
      },
    ];
    const ai = scriptedClient([{ call: "consultar_estoque", args: { query: "x" } }], "Temos X por R$ 10,00.");
    const r = await ai.runToolLoop({
      tier: "cheap",
      system: "sys",
      messages: [{ role: "user", content: "quanto é o X?" }],
      tools,
      maxTokens: 700,
    });
    expect(r.text).toBe("Temos X por R$ 10,00.");
    expect(r.toolsUsed).toEqual(["consultar_estoque"]);
    expect(r.stopped).toBe(false);
    expect(seen).toEqual([{ query: "x" }]);
  });

  it("handler com stop:true encerra o loop → stopped:true e texto vazio", async () => {
    const tools: ToolDef[] = [
      {
        name: "escalar_humano",
        description: "escala",
        jsonSchema: { type: "object" },
        handler: async () => ({ content: "escalado", stop: true }),
      },
      {
        name: "consultar_estoque",
        description: "consulta",
        jsonSchema: { type: "object" },
        handler: async () => ({ content: "não deveria rodar" }),
      },
    ];
    const ai = scriptedClient(
      [
        { call: "escalar_humano", args: { motivo: "reclamação" } },
        { call: "consultar_estoque", args: {} },
      ],
      "texto que não deve aparecer",
    );
    const r = await ai.runToolLoop({
      tier: "cheap",
      system: "sys",
      messages: [{ role: "user", content: "quero um humano" }],
      tools,
      maxTokens: 700,
    });
    expect(r.stopped).toBe(true);
    expect(r.text).toBe("");
    expect(r.toolsUsed).toEqual(["escalar_humano"]); // parou antes da 2ª tool
  });
});
