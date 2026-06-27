import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    user: { findMany: vi.fn() },
    message: { groupBy: vi.fn() },
  },
}));

describe("assignConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita conversa de outra conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    const { assignConversation } = await import("./inbox.service");
    await expect(assignConversation("dono-1", "lead-de-outro", "dono-1")).rejects.toThrow(
      /não encontrada/i,
    );
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it("rejeita operador que não é da conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1", queuedAt: null });
    (prisma.user.findMany as any).mockResolvedValue([]); // sem membros → só o dono é operador
    const { assignConversation } = await import("./inbox.service");
    await expect(assignConversation("dono-1", "lead-1", "op-de-outro")).rejects.toThrow(
      /não pertence/i,
    );
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it("atribui, pausa a IA e marca o início da fila", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1", queuedAt: null });
    (prisma.user.findMany as any).mockResolvedValue([{ id: "op-1" }]);
    (prisma.lead.update as any).mockResolvedValue({ id: "lead-1" });
    const { assignConversation } = await import("./inbox.service");
    await assignConversation("dono-1", "lead-1", "op-1");
    const arg = (prisma.lead.update as any).mock.calls[0][0];
    expect(arg.data).toMatchObject({
      assignedToId: "op-1",
      attendanceStatus: "ATENDENDO",
      aiPaused: true,
    });
    expect(arg.data.queuedAt).toBeInstanceOf(Date); // fila estava vazia → marca agora
  });
});

describe("resolveConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("devolve à IA por padrão", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1", queuedAt: new Date() });
    (prisma.lead.update as any).mockResolvedValue({ id: "lead-1" });
    const { resolveConversation } = await import("./inbox.service");
    await resolveConversation("dono-1", "lead-1");
    const arg = (prisma.lead.update as any).mock.calls[0][0];
    expect(arg.data).toMatchObject({
      attendanceStatus: "RESOLVIDA",
      aiPaused: false,
      aiPausedAt: null,
    });
  });

  it("não reativa a IA quando returnToAi=false", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1", queuedAt: new Date() });
    (prisma.lead.update as any).mockResolvedValue({ id: "lead-1" });
    const { resolveConversation } = await import("./inbox.service");
    await resolveConversation("dono-1", "lead-1", { returnToAi: false });
    const arg = (prisma.lead.update as any).mock.calls[0][0];
    expect(arg.data.attendanceStatus).toBe("RESOLVIDA");
    expect(arg.data).not.toHaveProperty("aiPaused");
  });
});

describe("markRead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava lastReadAt (zera a não-lida)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1", queuedAt: null });
    (prisma.lead.update as any).mockResolvedValue({ id: "lead-1" });
    const { markRead } = await import("./inbox.service");
    await markRead("dono-1", "lead-1");
    const arg = (prisma.lead.update as any).mock.calls[0][0];
    expect(arg.data.lastReadAt).toBeInstanceOf(Date);
  });
});

describe("listConversations + unread", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca não-lida quando o último INBOUND é mais novo que lastReadAt", async () => {
    const { prisma } = await import("@/server/db/client");
    const old = new Date("2026-01-01T10:00:00Z");
    const recent = new Date("2026-01-01T12:00:00Z");
    (prisma.lead.findMany as any).mockResolvedValue([
      {
        id: "lead-1",
        name: "Maria",
        phone: "+5511999999999",
        attendanceStatus: "FILA",
        assignedTo: null,
        whatsAppNumber: { displayName: "Empresa", label: "chip" },
        lastReadAt: old,
        queuedAt: old,
        messages: [{ content: "oi", createdAt: recent }],
      },
    ]);
    (prisma.message.groupBy as any).mockResolvedValue([
      { leadId: "lead-1", _max: { createdAt: recent } },
    ]);
    const { listConversations } = await import("./inbox.service");
    const rows = await listConversations("dono-1", { filter: "fila", sessionUserId: "dono-1" });
    expect(rows[0].unread).toBe(true);
    expect(rows[0].whatsAppNumber).toBe("Empresa");
  });
});
