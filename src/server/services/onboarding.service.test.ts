import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { planOnboardingSteps, type OnboardingPlanCtx } from "./onboarding.service";

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
    catalogItem: { count: vi.fn() },
    professional: { count: vi.fn() },
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
  catalogItems?: number;
  stockItems?: number;
  professionals?: number;
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
  // catalogItem.count é chamado 2x (total e trackStock) — resolve por argumento.
  (prisma.catalogItem.count as any).mockImplementation((args: any) =>
    Promise.resolve(args?.where?.trackStock ? (opts.stockItems ?? 0) : (opts.catalogItems ?? 0)),
  );
  (prisma.professional.count as any).mockResolvedValue(opts.professionals ?? 0);
}

// Plano completo (todas as features contratadas) para isolar o efeito do ramo.
const full: Omit<OnboardingPlanCtx, "category"> = {
  qualify: true,
  campaigns: true,
  schedule: true,
};
const keys = (ctx: OnboardingPlanCtx) => planOnboardingSteps(ctx).map((s) => s.key);

describe("planOnboardingSteps", () => {
  it("ramo de serviço/agenda (saude): catálogo de serviços + agenda, sem estoque", () => {
    const ks = keys({ ...full, category: "saude" });
    expect(ks).toContain("catalogo");
    expect(ks).toContain("agenda_setup");
    expect(ks).toContain("meeting");
    expect(ks).not.toContain("estoque");
    // copy do catálogo fala "serviços"
    const cat = planOnboardingSteps({ ...full, category: "saude" }).find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("servicos");
  });

  it("ramo de varejo: catálogo de produtos + estoque, sem agenda", () => {
    const ks = keys({ ...full, category: "varejo" });
    expect(ks).toContain("estoque");
    expect(ks).not.toContain("agenda_setup");
    expect(ks).not.toContain("meeting");
    const cat = planOnboardingSteps({ ...full, category: "varejo" }).find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("produtos");
  });

  it("ramo híbrido (beleza): estoque E agenda; catálogo fala 'produtos e serviços'", () => {
    const ks = keys({ ...full, category: "beleza" });
    expect(ks).toContain("estoque");
    expect(ks).toContain("agenda_setup");
    const cat = planOnboardingSteps({ ...full, category: "beleza" }).find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("ambos");
  });

  it("plano sem agenda: nenhum passo de agenda mesmo em ramo de hora marcada", () => {
    const ks = keys({ ...full, schedule: false, category: "saude" });
    expect(ks).not.toContain("agenda_setup");
    expect(ks).not.toContain("meeting");
  });

  it("plano sem qualify: sem passo de IA; sem campaigns: sem passo de campanha", () => {
    expect(keys({ ...full, qualify: false, category: "varejo" })).not.toContain("ai");
    expect(keys({ ...full, campaigns: false, category: "varejo" })).not.toContain("campaign");
  });

  it("categoria null (fail-open): mostra estoque E agenda (superconjunto seguro)", () => {
    const ks = keys({ ...full, category: null });
    expect(ks).toContain("estoque");
    expect(ks).toContain("agenda_setup");
    expect(ks).toContain("catalogo");
  });

  it("ordem segue a rotina do dono: ramo → número → IA → catálogo → estoque → agenda → leads → campanha → 1ª venda", () => {
    const ks = keys({ ...full, category: "beleza" });
    expect(ks).toEqual([
      "ramo", "number", "ai", "catalogo", "estoque", "agenda_setup", "leads", "campaign", "meeting",
    ]);
  });
});

describe("getOnboardingState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("INICIAL (category null): ramo + número + catálogo + estoque(fail-open) + leads → total = 5", async () => {
    await mockDb({ plan: "INICIAL" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toEqual([
      "ramo",
      "number",
      "catalogo",
      "estoque",
      "leads",
    ]);
  });

  it("ESCALA sem ramo definido (category null): superconjunto completo → 9 passos", async () => {
    await mockDb({ plan: "ESCALA", businessTemplateId: null });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toEqual([
      "ramo",
      "number",
      "ai",
      "catalogo",
      "estoque",
      "agenda_setup",
      "leads",
      "campaign",
      "meeting",
    ]);
  });

  it("ESCALA com ramo SEM agenda (loja-roupas-moda → varejo) omite agenda mas mantém estoque", async () => {
    await mockDb({ plan: "ESCALA", businessTemplateId: "loja-roupas-moda" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    const ks = state.steps.map((s) => s.key);
    expect(ks).not.toContain("meeting");
    expect(ks).not.toContain("agenda_setup");
    expect(ks).toEqual(["ramo", "number", "ai", "catalogo", "estoque", "leads", "campaign"]);
  });

  it("ESCALA com ramo COM agenda (salao-beleza → beleza) mantém o passo 'meeting'", async () => {
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

  it("passo 'catalogo' carrega a variant do ramo (varejo → produtos)", async () => {
    await mockDb({ plan: "ESCALA", businessTemplateId: "loja-roupas-moda" });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    const cat = state.steps.find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("produtos");
  });

  it("catálogo/estoque/agenda ficam done conforme as contagens reais", async () => {
    await mockDb({
      plan: "ESCALA",
      businessTemplateId: "salao-beleza",
      catalogItems: 3,
      stockItems: 1,
      professionals: 2,
    });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    const by = (k: string) => state.steps.find((s) => s.key === k)?.done;
    expect(by("catalogo")).toBe(true);
    expect(by("estoque")).toBe(true);
    expect(by("agenda_setup")).toBe(true);
  });

  it("plano null → ramo + número + catálogo + estoque(fail-open) + leads + campanha (total = 6)", async () => {
    await mockDb({ plan: null });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.steps.map((s) => s.key)).toEqual([
      "ramo",
      "number",
      "catalogo",
      "estoque",
      "leads",
      "campaign",
    ]);
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
      catalogItems: 5,
      stockItems: 2,
      professionals: 1,
    });
    const { getOnboardingState } = await import("./onboarding.service");
    const state = await getOnboardingState("dono-1");
    expect(state.done).toBe(true);
  });
});
