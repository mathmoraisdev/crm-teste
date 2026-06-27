import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    whatsAppNumber: { count: vi.fn() },
    lead: { count: vi.fn() },
    campaign: { count: vi.fn() },
    meeting: { count: vi.fn() },
  },
}));

// Zera todos os counts e o usuário; cada teste sobrescreve o que precisar.
async function mockDb(opts: {
  plan: string | null;
  aiProvider?: string | null;
  numbers?: number;
  leads?: number;
  campaigns?: number;
  meetings?: number;
}) {
  const { prisma } = await import("@/server/db/client");
  (prisma.user.findUnique as any).mockResolvedValue({
    plan: opts.plan,
    aiProvider: opts.aiProvider ?? null,
  });
  (prisma.whatsAppNumber.count as any).mockResolvedValue(opts.numbers ?? 0);
  (prisma.lead.count as any).mockResolvedValue(opts.leads ?? 0);
  (prisma.campaign.count as any).mockResolvedValue(opts.campaigns ?? 0);
  (prisma.meeting.count as any).mockResolvedValue(opts.meetings ?? 0);
}

describe("getOnboardingState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("INICIAL omite IA, campanha e agenda → total = 2 (número + leads)", async () => {
    await mockDb({ plan: "INICIAL" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.total).toBe(2);
    expect(state.steps.map((s) => s.key)).toEqual(["number", "leads"]);
  });

  it("ESCALA inclui os 5 passos → total = 5", async () => {
    await mockDb({ plan: "ESCALA" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.total).toBe(5);
    expect(state.steps.map((s) => s.key)).toEqual([
      "number",
      "leads",
      "ai",
      "campaign",
      "meeting",
    ]);
  });

  it("plano null → número + leads + campanha (total = 3), sem IA/agenda", async () => {
    await mockDb({ plan: null });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.total).toBe(3);
    expect(state.steps.map((s) => s.key)).toEqual(["number", "leads", "campaign"]);
  });

  it("done = true só quando todos os passos aplicáveis estão concluídos", async () => {
    await mockDb({
      plan: "ESCALA",
      aiProvider: "openai",
      numbers: 1,
      leads: 3,
      campaigns: 1,
      meetings: 1,
    });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.completed).toBe(5);
    expect(state.total).toBe(5);
    expect(state.done).toBe(true);
  });

  it("done = false enquanto faltar algum passo aplicável", async () => {
    await mockDb({
      plan: "ESCALA",
      aiProvider: "openai",
      numbers: 1,
      leads: 3,
      campaigns: 1,
      meetings: 0, // falta a reunião
    });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.completed).toBe(4);
    expect(state.total).toBe(5);
    expect(state.done).toBe(false);
  });
});
