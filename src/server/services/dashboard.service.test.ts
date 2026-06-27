import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    message: { groupBy: vi.fn() },
    whatsAppNumber: { findMany: vi.fn() },
    outboundJob: { groupBy: vi.fn() },
    campaign: { findMany: vi.fn() },
    meeting: { count: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

describe("getDashboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("taxas com divisor zero não estouram (retorna 0)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.groupBy as any).mockResolvedValue([]);
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    (prisma.whatsAppNumber.findMany as any).mockResolvedValue([]);
    (prisma.outboundJob.groupBy as any).mockResolvedValue([]);
    (prisma.campaign.findMany as any).mockResolvedValue([]);
    (prisma.meeting.count as any).mockResolvedValue(0);
    (prisma.user.findMany as any).mockResolvedValue([]);

    const { getDashboard } = await import("./dashboard.service");
    const data = await getDashboard("dono-1", { days: 30 });

    expect(data.totals.leads).toBe(0);
    expect(data.rates.qualifiedRate).toBe(0);
    expect(data.rates.meetingRate).toBe(0);
    expect(data.sla.avgFirstResponseSeconds).toBeNull();
    expect(data.funnel).toHaveLength(6); // uma entrada por etapa do enum
  });

  it("calcula taxas e funil a partir dos grupos", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.groupBy as any).mockImplementation(({ by }: any) => {
      // 1ª chamada = funil por status; 2ª = resolvidas por atendente.
      if (by?.includes("status")) {
        return Promise.resolve([
          { status: "NOVO", _count: { _all: 6 } },
          { status: "QUALIFICADO", _count: { _all: 3 } },
          { status: "REUNIAO_AGENDADA", _count: { _all: 1 } },
        ]);
      }
      return Promise.resolve([]);
    });
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    (prisma.whatsAppNumber.findMany as any).mockResolvedValue([]);
    (prisma.outboundJob.groupBy as any).mockResolvedValue([]);
    (prisma.campaign.findMany as any).mockResolvedValue([]);
    (prisma.meeting.count as any).mockResolvedValue(0);
    (prisma.user.findMany as any).mockResolvedValue([]);

    const { getDashboard } = await import("./dashboard.service");
    const data = await getDashboard("dono-1", { days: 7 });

    expect(data.totals.leads).toBe(10);
    expect(data.totals.qualified).toBe(4); // QUALIFICADO + REUNIAO_AGENDADA
    expect(data.totals.meetings).toBe(1);
    expect(data.rates.qualifiedRate).toBeCloseTo(0.4);
    expect(data.rates.meetingRate).toBeCloseTo(0.25);
  });
});
