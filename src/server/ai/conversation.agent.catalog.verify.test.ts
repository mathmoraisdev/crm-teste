import { describe, it, expect } from "vitest";
import { generateAttendanceReply } from "./conversation.agent";
import { renderCatalogForAI } from "./attendance-context";

// Verificação E2E leve (Task 5.1): confirma que o bloco de catálogo REALMENTE
// chega no prompt enviado à IA — e que o override (system prompt avançado) o ignora.
function stubAi(capture: { user?: string }) {
  return {
    generateText: async (opts: { user: string }) => {
      capture.user = opts.user;
      return "ok";
    },
  } as any;
}

describe("catálogo → prompt de atendimento (verify)", () => {
  const catalogBlock = renderCatalogForAI([
    { name: "X-Burguer", priceCents: 2500, kind: "PRODUTO" },
    { name: "Corte", priceCents: 0, kind: "SERVICO" },
  ]);

  it("injeta os itens do catálogo no prompt quando não há override", async () => {
    const cap: { user?: string } = {};
    await generateAttendanceReply({
      ai: stubAi(cap),
      company: { displayName: "Acme", systemPromptOverride: null },
      catalogBlock,
      conversation: [{ role: "lead", text: "quais lanches vocês têm?" }] as any,
    });
    expect(cap.user).toContain("SERVIÇOS E PRODUTOS");
    expect(cap.user).toContain("X-Burguer");
    expect(cap.user).toContain("R$ 25,00");
    expect(cap.user).toMatch(/Corte.*sob consulta/);
  });

  it("ignora o catálogo quando há system prompt avançado (override)", async () => {
    const cap: { user?: string } = {};
    await generateAttendanceReply({
      ai: stubAi(cap),
      company: { displayName: "Acme", systemPromptOverride: "Você é o Bob. Responda curto." },
      catalogBlock,
      conversation: [{ role: "lead", text: "oi" }] as any,
    });
    expect(cap.user).not.toContain("SERVIÇOS E PRODUTOS");
    expect(cap.user).not.toContain("X-Burguer");
  });
});
