import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => {
  const prisma: any = {
    lead: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    message: { groupBy: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  // recordAudit roda dentro de prisma.$transaction — o mock delega ao próprio prisma.
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return { prisma };
});

describe("assignConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita conversa de outra conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    const { assignConversation } = await import("./inbox.service");
    await expect(assignConversation("dono-1", "lead-de-outro", "dono-1", "dono-1")).rejects.toThrow(
      /não encontrada/i,
    );
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it("rejeita operador que não é da conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1", queuedAt: null });
    (prisma.user.findMany as any).mockResolvedValue([]); // sem membros → só o dono é operador
    const { assignConversation } = await import("./inbox.service");
    await expect(assignConversation("dono-1", "lead-1", "op-de-outro", "dono-1")).rejects.toThrow(
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
    await assignConversation("dono-1", "lead-1", "op-1", "actor-1");
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
    expect(rows[0].needsResponse).toBe(true); // FILA precisa de resposta
  });

  it("'todas' inclui as conversas em IA (monitorar/assumir)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    const { listConversations } = await import("./inbox.service");
    await listConversations("dono-1", { filter: "todas", sessionUserId: "dono-1" });
    const where = (prisma.lead.findMany as any).mock.calls[0][0].where;
    expect(where.attendanceStatus.in).toEqual(
      expect.arrayContaining(["IA", "FILA", "ATENDENDO", "AGUARDANDO"]),
    );
    expect(where.attendanceStatus.in).not.toContain("RESOLVIDA");
  });

  it("'ia' filtra só conversas atendidas pela IA", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    const { listConversations } = await import("./inbox.service");
    await listConversations("dono-1", { filter: "ia", sessionUserId: "dono-1" });
    const where = (prisma.lead.findMany as any).mock.calls[0][0].where;
    expect(where.attendanceStatus).toBe("IA");
  });

  it("'nao-respondidas' filtra FILA e ATENDENDO (precisa de resposta)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    const { listConversations } = await import("./inbox.service");
    await listConversations("dono-1", { filter: "nao-respondidas", sessionUserId: "dono-1" });
    const where = (prisma.lead.findMany as any).mock.calls[0][0].where;
    expect(where.attendanceStatus.in).toEqual(["FILA", "ATENDENDO"]);
  });

  it("needsResponse true só em FILA/ATENDENDO", async () => {
    const { prisma } = await import("@/server/db/client");
    const baseLead = (id: string, status: string) => ({
      id,
      name: id,
      phone: "+5511",
      attendanceStatus: status,
      status: "NEW",
      assignedTo: null,
      whatsAppNumber: null,
      lastReadAt: null,
      queuedAt: null,
      firstResponseAt: null,
      attendingUserId: null,
      attendingTo: null,
      optOut: false,
      messages: [],
    });
    (prisma.lead.findMany as any).mockResolvedValue([
      baseLead("lead-fila", "FILA"),
      baseLead("lead-aguardando", "AGUARDANDO"),
      baseLead("lead-atendendo", "ATENDENDO"),
    ]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    const { listConversations } = await import("./inbox.service");
    const rows = await listConversations("dono-1", { filter: "todas", sessionUserId: "dono-1" });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.needsResponse]));
    expect(byId).toEqual({ "lead-fila": true, "lead-aguardando": false, "lead-atendendo": true });
  });

  it("marca SLA breached e ordena a fila por mais antigo primeiro", async () => {
    const { prisma } = await import("@/server/db/client");
    const old = new Date(Date.now() - 60 * 60_000); // 60min atrás → estoura meta de 5min
    const recent = new Date(Date.now() - 1 * 60_000); // 1min atrás
    (prisma.lead.findMany as any).mockResolvedValue([
      {
        id: "novo", name: "Novo", phone: "+551", attendanceStatus: "FILA", assignedTo: null,
        whatsAppNumber: null, lastReadAt: null, queuedAt: recent, firstResponseAt: null,
        messages: [{ content: "b", createdAt: recent }],
      },
      {
        id: "antigo", name: "Antigo", phone: "+552", attendanceStatus: "FILA", assignedTo: null,
        whatsAppNumber: null, lastReadAt: null, queuedAt: old, firstResponseAt: null,
        messages: [{ content: "a", createdAt: old }],
      },
    ]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    (prisma.user.findUnique as any).mockResolvedValue({ inboxSlaMinutes: 5 });
    const { listConversations } = await import("./inbox.service");
    const rows = await listConversations("dono-1", { filter: "fila", sessionUserId: "dono-1" });
    // Fila: mais antigo primeiro.
    expect(rows.map((r) => r.id)).toEqual(["antigo", "novo"]);
    expect(rows[0].sla.status).toBe("breached");
  });

  it("sem meta de SLA → status ok mesmo com fila antiga", async () => {
    const { prisma } = await import("@/server/db/client");
    const old = new Date(Date.now() - 120 * 60_000);
    (prisma.lead.findMany as any).mockResolvedValue([
      {
        id: "lead-1", name: "X", phone: "+551", attendanceStatus: "FILA", assignedTo: null,
        whatsAppNumber: null, lastReadAt: null, queuedAt: old, firstResponseAt: null,
        messages: [{ content: "a", createdAt: old }],
      },
    ]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    (prisma.user.findUnique as any).mockResolvedValue({ inboxSlaMinutes: null });
    const { listConversations } = await import("./inbox.service");
    const rows = await listConversations("dono-1", { filter: "fila", sessionUserId: "dono-1" });
    expect(rows[0].sla.status).toBe("ok");
  });
});
