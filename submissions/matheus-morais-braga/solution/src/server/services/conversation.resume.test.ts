import { describe, it, expect, vi, beforeEach } from "vitest";

// conversation.service importa transitivamente env.ts, que valida DATABASE_URL no
// load. O teste não toca no banco real (prisma mockado), só precisa do load passar.
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

// conversation.service puxa cliente de IA / envio / agendamento no topo; o teste
// só exercita a seleção de candidatos (prisma puro), então mockamos o banco.
vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findMany: vi.fn(), updateMany: vi.fn() },
    message: { findMany: vi.fn() },
    whatsAppNumber: { findMany: vi.fn() },
  },
}));

const MSG = (direction: "INBOUND" | "OUTBOUND", content = "oi") => ({ direction, content });

describe("isLeadAwaitingAiReply", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true quando o último textual é INBOUND sem resposta depois", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.message.findMany as any).mockResolvedValue([MSG("INBOUND", "qual o preço?")]);
    const { isLeadAwaitingAiReply } = await import("./conversation.service");
    expect(await isLeadAwaitingAiReply("lead-1")).toBe(true);
  });

  it("false quando o operador já respondeu (último é OUTBOUND)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.message.findMany as any).mockResolvedValue([
      MSG("OUTBOUND", "já te respondo"),
      MSG("INBOUND", "qual o preço?"),
    ]);
    const { isLeadAwaitingAiReply } = await import("./conversation.service");
    expect(await isLeadAwaitingAiReply("lead-1")).toBe(false);
  });

  it("ignora placeholder de mídia, mas pega o INBOUND textual anterior", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.message.findMany as any).mockResolvedValue([
      MSG("INBOUND", "📷 Imagem"),
      MSG("INBOUND", "qual o preço?"),
    ]);
    const { isLeadAwaitingAiReply } = await import("./conversation.service");
    expect(await isLeadAwaitingAiReply("lead-1")).toBe(true);
  });

  it("false sem mensagens", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.message.findMany as any).mockResolvedValue([]);
    const { isLeadAwaitingAiReply } = await import("./conversation.service");
    expect(await isLeadAwaitingAiReply("lead-1")).toBe(false);
  });
});

describe("reconcileAiResume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consome o sinal de devolução e nudga só quem ainda aguarda", async () => {
    const { prisma } = await import("@/server/db/client");
    // dois leads com sinal pendente; um aguarda (INBOUND), outro já respondido
    (prisma.lead.findMany as any)
      .mockResolvedValueOnce([{ id: "lead-a" }, { id: "lead-b" }]) // pending
      .mockResolvedValueOnce([]); // paused (inatividade) — nenhum
    (prisma.message.findMany as any)
      .mockResolvedValueOnce([MSG("INBOUND")]) // lead-a aguarda
      .mockResolvedValueOnce([MSG("OUTBOUND")]); // lead-b já respondido
    (prisma.lead.updateMany as any).mockResolvedValue({ count: 2 });

    const { reconcileAiResume } = await import("./conversation.service");
    const ids = await reconcileAiResume(new Date("2026-06-29T12:00:00Z"));

    // limpa o sinal dos dois (one-shot), mas só nudga o que aguarda
    expect((prisma.lead.updateMany as any).mock.calls[0][0].data).toEqual({
      aiResumePendingAt: null,
    });
    expect(ids).toEqual(["lead-a"]);
  });

  it("resume por inatividade quando o handoff esfriou além do limite do número", async () => {
    const { prisma } = await import("@/server/db/client");
    const now = new Date("2026-06-29T12:00:00Z");
    const pausedHaMuito = new Date(now.getTime() - 31 * 60_000); // 31 min atrás
    const pausedAgora = new Date(now.getTime() - 1 * 60_000); // 1 min atrás
    (prisma.lead.findMany as any)
      .mockResolvedValueOnce([]) // sem sinais pendentes
      .mockResolvedValueOnce([
        { id: "frio", aiPausedAt: pausedHaMuito, whatsAppNumberId: "num-1" },
        { id: "quente", aiPausedAt: pausedAgora, whatsAppNumberId: "num-1" },
      ]);
    (prisma.whatsAppNumber.findMany as any).mockResolvedValue([
      { id: "num-1", inactivityResumeMinutes: 30 },
    ]);
    (prisma.message.findMany as any).mockResolvedValue([MSG("INBOUND")]); // ambos aguardam

    const { reconcileAiResume } = await import("./conversation.service");
    const ids = await reconcileAiResume(now);

    // só o que passou de 30 min entra; o recém-pausado não
    expect(ids).toEqual(["frio"]);
  });

  it("não resume por inatividade quando o número não configura o tempo (0)", async () => {
    const { prisma } = await import("@/server/db/client");
    const now = new Date("2026-06-29T12:00:00Z");
    (prisma.lead.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "frio", aiPausedAt: new Date(now.getTime() - 60 * 60_000), whatsAppNumberId: "num-1" },
      ]);
    (prisma.whatsAppNumber.findMany as any).mockResolvedValue([
      { id: "num-1", inactivityResumeMinutes: 0 },
    ]);
    (prisma.message.findMany as any).mockResolvedValue([MSG("INBOUND")]);

    const { reconcileAiResume } = await import("./conversation.service");
    expect(await reconcileAiResume(now)).toEqual([]);
  });
});
