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
  businessTemplateId?: string | null;
  numbers?: number;
  leads?: number;
  campaigns?: number;
  meetings?: number;
}) {
  const { prisma } = await import("@/server/db/client");
  (prisma.user.findUnique as any).mockResolvedValue({
    plan: opts.plan,
    aiProvider: opts.aiProvider ?? null,
    businessTemplateId: opts.businessTemplateId ?? null,
  });
  (prisma.whatsAppNumber.count as any).mockResolvedValue(opts.numbers ?? 0);
  (prisma.lead.count as any).mockResolvedValue(opts.leads ?? 0);
  (prisma.campaign.count as any).mockResolvedValue(opts.campaigns ?? 0);
  (prisma.meeting.count as any).mockResolvedValue(opts.meetings ?? 0);
}

describe("getOnboardingState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("INICIAL: ramo + número + leads (sem IA/campanha/agenda) → total = 3", async () => {
    await mockDb({ plan: "INICIAL" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toEqual(["ramo", "number", "leads"]);
  });

  it("ESCALA sem ramo definido (category null): agenda aparece (fail-open) → 6 passos", async () => {
    await mockDb({ plan: "ESCALA", businessTemplateId: null });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toEqual([
      "ramo",
      "number",
      "leads",
      "ai",
      "campaign",
      "meeting",
    ]);
  });

  it("ESCALA com ramo SEM agenda (loja-roupas-moda) omite o passo 'meeting'", async () => {
    await mockDb({ plan: "ESCALA", businessTemplateId: "loja-roupas-moda" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).not.toContain("meeting");
    expect(state.steps.map((s) => s.key)).toEqual(["ramo", "number", "leads", "ai", "campaign"]);
  });

  it("ESCALA com ramo COM agenda (salao-beleza) mantém o passo 'meeting'", async () => {
    await mockDb({ plan: "ESCALA", businessTemplateId: "salao-beleza" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toContain("meeting");
  });

  it("passo 'ramo' fica done quando businessTemplateId != null", async () => {
    await mockDb({ plan: "INICIAL", businessTemplateId: "salao-beleza" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    const ramo = state.steps.find((s) => s.key === "ramo");
    expect(ramo?.done).toBe(true);
  });

  it("plano null → ramo + número + leads + campanha (total = 4)", async () => {
    await mockDb({ plan: null });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toEqual(["ramo", "number", "leads", "campaign"]);
  });

  it("done = true só quando todos os passos aplicáveis (incl. ramo) estão concluídos", async () => {
    await mockDb({
      plan: "ESCALA",
      aiProvider: "openai",
      businessTemplateId: "salao-beleza",
      numbers: 1,
      leads: 3,
      campaigns: 1,
      meetings: 1,
    });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.done).toBe(true);
  });
});
