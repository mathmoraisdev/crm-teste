import { describe, it, expect, beforeAll } from "vitest";
import { makeScriptedToolLoopClient } from "./testing/fake-ai-client";
import { generateAgenticReply } from "./conversation.agent";
import type { ConversationTurn } from "./transcript";
import type { ToolDef } from "./provider";

// conversation.agent.ts → attendance-context → @/lib/env (lê DATABASE_URL).
beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

const conversation: ConversationTurn[] = [
  { direction: "INBOUND", content: "quanto tá o corte?" },
];

function stockTool(onCall: () => void): ToolDef {
  return {
    name: "consultar_estoque",
    description: "consulta",
    jsonSchema: { type: "object" },
    handler: async () => {
      onCall();
      return { content: "id=ci_1 | Corte | R$ 40,00 | estoque=—" };
    },
  };
}

describe("generateAgenticReply", () => {
  it("roda a tool do script e devolve texto sanitizado + toolsUsed", async () => {
    let called = 0;
    const ai = makeScriptedToolLoopClient(
      [{ call: "consultar_estoque", args: { query: "corte" } }],
      { finalText: "Vendedor: O corte sai por R$ 40,00. [site](http://x)" },
    );
    const r = await generateAgenticReply({
      ai,
      company: { displayName: "Barbearia", persona: null },
      conversation,
      tools: [stockTool(() => (called += 1))],
    });
    expect(called).toBe(1);
    expect(r.toolsUsed).toEqual(["consultar_estoque"]);
    expect(r.stopped).toBe(false);
    // sanitização: rótulo de locutor removido e link markdown virou texto plano
    expect(r.text).not.toMatch(/^Vendedor:/);
    expect(r.text).not.toContain("[site]");
    expect(r.text).toContain("site (http://x)");
    expect(r.text).toContain("R$ 40,00");
  });

  it("sem tools no script → comporta como resposta simples", async () => {
    const ai = makeScriptedToolLoopClient([], { finalText: "Oi! Como posso ajudar?" });
    const r = await generateAgenticReply({
      ai,
      company: { displayName: "Barbearia" },
      conversation,
      tools: [stockTool(() => {})],
    });
    expect(r.toolsUsed).toEqual([]);
    expect(r.stopped).toBe(false);
    expect(r.text).toBe("Oi! Como posso ajudar?");
  });

  it("handler com stop → texto vazio e stopped:true", async () => {
    const escalar: ToolDef = {
      name: "escalar_humano",
      description: "escala",
      jsonSchema: { type: "object" },
      handler: async () => ({ content: "escalado", stop: true }),
    };
    const ai = makeScriptedToolLoopClient([{ call: "escalar_humano", args: {} }]);
    const r = await generateAgenticReply({
      ai,
      company: { displayName: "Barbearia" },
      conversation,
      tools: [escalar],
    });
    expect(r.stopped).toBe(true);
    expect(r.text).toBe("");
    expect(r.toolsUsed).toEqual(["escalar_humano"]);
  });
});
