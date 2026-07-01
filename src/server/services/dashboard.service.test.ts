import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    message: { groupBy: vi.fn(), findMany: vi.fn() },
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
    (prisma.message.findMany as any).mockResolvedValue([]);
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
    expect(data.aiSla.avgResponseSeconds).toBeNull(); // sem respostas da IA → null
    expect(data.funnel).toHaveLength(8); // uma entrada por etapa do enum (inclui OFERTA_ENVIADA/PAGO)
  });

  it("pareia resposta da IA ao 1º inbound da rajada (SLA da IA)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.groupBy as any).mockResolvedValue([]);
    (prisma.lead.findMany as any).mockResolvedValue([]);
    (prisma.message.groupBy as any).mockResolvedValue([]);
    // Conversa A: lead manda 2 msgs picadas (rajada), IA responde 30s após a 1ª.
    // Conversa B: 1 inbound, IA responde 10s depois.
    (prisma.message.findMany as any).mockResolvedValue([
      { leadId: "A", direction: "INBOUND", createdAt: new Date("2026-06-29T10:00:00Z") },
      { leadId: "A", direction: "INBOUND", createdAt: new Date("2026-06-29T10:00:05Z") },
      { leadId: "A", direction: "OUTBOUND", createdAt: new Date("2026-06-29T10:00:30Z") },
      { leadId: "B", direction: "INBOUND", createdAt: new Date("2026-06-29T11:00:00Z") },
      { leadId: "B", direction: "OUTBOUND", createdAt: new Date("2026-06-29T11:00:10Z") },
    ]);
    (prisma.whatsAppNumber.findMany as any).mockResolvedValue([]);
    (prisma.outboundJob.groupBy as any).mockResolvedValue([]);
    (prisma.campaign.findMany as any).mockResolvedValue([]);
    (prisma.meeting.count as any).mockResolvedValue(0);
    (prisma.user.findMany as any).mockResolvedValue([]);

    const { getDashboard } = await import("./dashboard.service");
    const data = await getDashboard("dono-1", { days: 30 });

    expect(data.aiSla.sampleSize).toBe(2); // duas respostas pareadas
    expect(data.aiSla.avgResponseSeconds).toBe(20); // (30 + 10) / 2
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
    (prisma.message.findMany as any).mockResolvedValue([]);
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
