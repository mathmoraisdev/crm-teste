import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

vi.mock("@/server/db/client", () => ({
  prisma: { lead: { findMany: vi.fn(), count: vi.fn() } },
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
