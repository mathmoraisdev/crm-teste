import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeScriptedToolLoopClient, type ScriptedStep } from "@/server/ai/testing/fake-ai-client";
import type { AiClient } from "@/server/ai/provider";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

// ── Estado controlável pelos testes ──────────────────────────────────────
const state = {
  aiToolCallingEnabled: true,
  aiPausedOnRecheck: false, // valor de aiPaused no recheck pós-geração
  client: null as AiClient | null,
};

vi.mock("@/server/db/client", () => {
  const fullLead = () => ({
    id: "lead_1",
    status: "EM_CONVERSA",
    aiPaused: false,
    aiPausedAt: null,
    whatsAppNumberId: "num_1",
    userId: "acc_1",
    phone: "5511999",
    name: "João",
    queuedAt: null,
  });
  return {
    prisma: {
      lead: {
        findUnique: vi.fn((args: { select?: { aiPaused?: boolean } }) =>
          Promise.resolve(
            args?.select?.aiPaused
              ? { aiPaused: state.aiPausedOnRecheck } // recheck de aiStillActive
              : fullLead(),
          ),
        ),
        update: vi.fn(() => Promise.resolve({})),
      },
      meeting: { findUnique: vi.fn(() => Promise.resolve(null)) },
      message: {
        findFirst: vi.fn(() => Promise.resolve(null)), // sem inbound → pula branch de agendamento
        findMany: vi.fn(() =>
          Promise.resolve([
            { direction: "INBOUND", content: "quanto tá o corte?", createdAt: new Date("2026-07-06T12:00:00Z") },
          ]),
        ),
      },
      whatsAppNumber: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            displayName: "Barbearia", label: "num", aiModel: null, systemPromptOverride: null,
            persona: null, knowledgeBase: null, businessHours: null, customInstructions: null,
            autoReplyEnabled: true, qualifyEnabled: false, scheduleEnabled: false,
            salesEnabled: false, aiToolCallingEnabled: state.aiToolCallingEnabled,
            contextResetMinutes: 180,
          }),
        ),
      },
    },
  };
});

vi.mock("@/server/cache/cache", () => ({
  cached: (_k: string, _ttl: number, fn: () => unknown) => fn(),
}));
vi.mock("@/server/cache/keys", () => ({
  cacheKeys: { conversation: () => "k" },
  invalidateConversation: vi.fn(),
  invalidateLeadCaches: vi.fn(),
}));
vi.mock("@/server/ai/resolve", () => ({ getAiClient: vi.fn(() => Promise.resolve(state.client)) }));
vi.mock("@/server/services/entitlements", () => ({
  consumeAiCredit: vi.fn(() => Promise.resolve({ allowed: true })),
  resolveAiModelForUser: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/server/services/messaging", () => ({
  sendWhatsAppMessage: vi.fn(() => Promise.resolve()),
  enqueueManualReply: vi.fn(),
  sendWhatsAppMedia: vi.fn(),
  enqueueManualMedia: vi.fn(),
}));
vi.mock("@/server/services/catalog.service", () => ({
  listCatalogItems: vi.fn(() =>
    Promise.resolve([
      { id: "ci_1", kind: "SERVICO", name: "Corte", priceCents: 4000, active: true, trackStock: false, sku: null, stockQty: 0, minStock: 0, costCents: null, printSector: null, durationMinutes: null },
    ]),
  ),
}));

import { sendWhatsAppMessage } from "@/server/services/messaging";
const sendMock = vi.mocked(sendWhatsAppMessage);

async function run(steps: ScriptedStep[], finalText: string) {
  state.client = makeScriptedToolLoopClient(steps, { finalText });
  const { respondToLead } = await import("./conversation.service");
  await respondToLead("lead_1");
}

beforeEach(() => {
  vi.clearAllMocks();
  state.aiToolCallingEnabled = true;
  state.aiPausedOnRecheck = false;
});

describe("respondToLead — caminho agêntico (gated)", () => {
  it("número COM a flag: roda a tool e envia o texto final", async () => {
    await run([{ call: "consultar_estoque", args: { query: "corte" } }], "O corte sai por R$ 40,00.");
    // 1 envio (a resposta final); consultar_estoque é read-only e não envia.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toContain("R$ 40,00");
  });

  it("recheck aiStillActive=false após a geração → NÃO envia por cima do humano", async () => {
    state.aiPausedOnRecheck = true;
    await run([{ call: "consultar_estoque", args: {} }], "resposta que não deve sair");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("número SEM a flag: usa o caminho de texto de hoje (não usa runToolLoop)", async () => {
    state.aiToolCallingEnabled = false;
    // Fake que só responde texto — se o código tocasse runToolLoop aqui, lançaria.
    const textClient: AiClient = {
      generateText: async () => "Olá! Como posso ajudar?",
      forcedToolCall: async () => null,
      runToolLoop: async () => {
        throw new Error("runToolLoop não deve ser chamado no caminho sem flag");
      },
    };
    state.client = textClient;
    const { respondToLead } = await import("./conversation.service");
    await respondToLead("lead_1");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toContain("Como posso ajudar");
  });
});
