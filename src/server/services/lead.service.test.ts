import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    whatsAppNumber: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

// O invalidateLeadCaches toca Redis/SSE — vira no-op nos testes de unidade.
vi.mock("@/server/cache/keys", () => ({
  invalidateLeadCaches: vi.fn().mockResolvedValue(undefined),
}));

describe("listLeads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("limita take a 100 e retorna { items, total }", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.lead.count as any).mockResolvedValue(0);
    const { listLeads } = await import("./lead.service");
    const res = await listLeads("user-1", { take: 999 });
    expect(res).toEqual({ items: [], total: 0 });
    const arg = (prisma.lead.findMany as any).mock.calls[0][0];
    expect(arg.take).toBe(100);
  });

  it("aplica filtros (status, campanha=none, query) no where", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.lead.count as any).mockResolvedValue(0);
    const { listLeads } = await import("./lead.service");
    await listLeads("user-1", { status: "NOVO" as any, campaignId: null, query: "ana" });
    const arg = (prisma.lead.findMany as any).mock.calls[0][0];
    expect(arg.where.status).toBe("NOVO");
    expect(arg.where.campaignId).toBeNull();
    expect(arg.where.OR).toBeTruthy();
  });
});

describe("resolveOrCreateLeadByPhone", () => {
  beforeEach(() => vi.clearAllMocks());

  async function load() {
    const { resolveOrCreateLeadByPhone } = await import("./lead.service");
    return resolveOrCreateLeadByPhone;
  }

  it("cria o lead vinculado ao chip primário conectado quando não existe", async () => {
    const { prisma } = await import("@/server/db/client");
    // Chip primário: primeiro findFirst (CONNECTED) devolve o chip; o de fallback
    // não é chamado por causa do ??.
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValueOnce({ id: "chip1" });
    (prisma.lead.findFirst as any).mockResolvedValue(null); // não existe
    // Plano null = ilimitado (assertContactQuota passa sem contar).
    (prisma.user.findUnique as any).mockResolvedValue({ email: "owner@test", plan: null });
    (prisma.lead.create as any).mockResolvedValue({ id: "lead1", phone: "+5541999998888" });

    const fn = await load();
    const res = await fn("acc1", { phone: "(41) 99999-8888" });

    expect(res.created).toBe(true);
    expect(res.lead.id).toBe("lead1");
    const createArg = (prisma.lead.create as any).mock.calls[0][0].data;
    expect(createArg).toMatchObject({
      userId: "acc1",
      whatsAppNumberId: "chip1",
      phone: "+5541999998888",
      name: "+5541999998888", // sem nome → o telefone vira rótulo
      status: "NOVO",
      consentSource: "manual_outbound",
    });
  });

  it("reabre lead existente mesmo se o número vier sem o 9º dígito (variante)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValue({ id: "chip1" });
    // O lead foi salvo COM o 9; o operador cola SEM o 9 → findFirst casa pela variante.
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead1", name: "+5541999998888" });
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({ id: "lead1", phone: "+5541999998888" });

    const fn = await load();
    const res = await fn("acc1", { phone: "+554199998888", whatsAppNumberId: "chip1" });

    expect(res.created).toBe(false);
    const where = (prisma.lead.findFirst as any).mock.calls[0][0].where;
    expect(where.whatsAppNumberId).toBe("chip1");
    // O telefone é casado por variantes (com e sem o 9), não pela forma exata.
    expect(where.phone.in).toContain("+5541999998888");
    expect(where.phone.in).toContain("+554199998888");
    expect(prisma.lead.create as any).not.toHaveBeenCalled();
    expect(prisma.lead.update as any).not.toHaveBeenCalled();
  });

  it("atualiza o nome se antes era o placeholder (próprio telefone) e veio um nome", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValue({ id: "chip1" });
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead1", name: "+5541999998888" });
    (prisma.lead.update as any).mockResolvedValue({ id: "lead1", name: "João" });

    const fn = await load();
    const res = await fn("acc1", { phone: "+5541999998888", name: "João", whatsAppNumberId: "chip1" });

    expect(res.created).toBe(false);
    const upd = (prisma.lead.update as any).mock.calls[0][0];
    expect(upd.where.id).toBe("lead1");
    expect(upd.data.name).toBe("João");
    expect(prisma.lead.create as any).not.toHaveBeenCalled();
  });

  it("lança se o chip informado não pertence à conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValue(null); // não acha

    const fn = await load();
    await expect(
      fn("acc1", { phone: "+5541999998888", whatsAppNumberId: "other" }),
    ).rejects.toThrow("Chip não encontrado.");
    expect(prisma.lead.create as any).not.toHaveBeenCalled();
  });

  it("lança ao estourar o teto de contatos do plano", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValueOnce({ id: "chip1" });
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    // Plano INICIAL = 1000 contatos; conta já está no limite.
    (prisma.user.findUnique as any).mockResolvedValue({ email: "paid@test", plan: "INICIAL" });
    (prisma.lead.count as any).mockResolvedValue(1000);

    const fn = await load();
    await expect(fn("acc1", { phone: "+5541999998888" })).rejects.toThrow(/limite atingido/i);
    expect(prisma.lead.create as any).not.toHaveBeenCalled();
  });
});
