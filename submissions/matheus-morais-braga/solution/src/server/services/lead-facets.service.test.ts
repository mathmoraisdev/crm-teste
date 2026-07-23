import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { groupBy: vi.fn() },
    tag: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
  },
}));

describe("getLeadFacets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna contagem por status + listas de campanhas e tags", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.groupBy as any).mockResolvedValue([{ status: "NOVO", _count: { _all: 3 } }]);
    (prisma.campaign.findMany as any).mockResolvedValue([{ id: "c1", name: "C1" }]);
    (prisma.tag.findMany as any).mockResolvedValue([{ id: "t1", name: "T1" }]);
    const { getLeadFacets } = await import("./lead-facets.service");
    const f = await getLeadFacets("user-1");
    expect(f.byStatus.NOVO).toBe(3);
    expect(f.total).toBe(3);
    expect(f.campaigns).toHaveLength(1);
    expect(f.tags).toHaveLength(1);
  });
});
