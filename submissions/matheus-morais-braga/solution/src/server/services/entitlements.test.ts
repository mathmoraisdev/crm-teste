import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ADMIN_EMAILS = "admin@exemplo.com";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/server/ai/resolve", () => ({
  resolveProviderForUser: vi.fn(),
}));

describe("assertFeature", () => {
  beforeEach(() => vi.clearAllMocks());

  it("INICIAL não inclui campanhas → rejeita", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    const { assertFeature } = await import("./entitlements");
    await expect(assertFeature("dono-1", "campaigns")).rejects.toThrow(/não inclui/i);
  });

  it("INICIAL não inclui qualificação → rejeita", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    const { assertFeature } = await import("./entitlements");
    await expect(assertFeature("dono-1", "qualify")).rejects.toThrow(/não inclui/i);
  });

  it("PROFISSIONAL inclui campanhas → permite", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "PROFISSIONAL" });
    const { assertFeature } = await import("./entitlements");
    await expect(assertFeature("dono-1", "campaigns")).resolves.toBeUndefined();
  });

  it("plano null não aplica gate (grandfather)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: null });
    const { assertFeature } = await import("./entitlements");
    await expect(assertFeature("dono-1", "campaigns")).resolves.toBeUndefined();
  });

  it("admin da plataforma não tem gate", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "admin@exemplo.com", plan: "INICIAL" });
    const { assertFeature } = await import("./entitlements");
    await expect(assertFeature("admin-1", "campaigns")).resolves.toBeUndefined();
  });
});

describe("monthKey", () => {
  it("formata YYYY-MM em UTC", async () => {
    const { monthKey } = await import("./entitlements");
    expect(monthKey(new Date("2026-06-28T23:00:00Z"))).toBe("2026-06");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("consumeAiCredit", () => {
  beforeEach(() => vi.clearAllMocks());

  const NOW = new Date("2026-06-15T12:00:00Z"); // mês "2026-06"

  it("BYOK (source=user) → ilimitado, não conta nem persiste", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "user" });
    const { prisma } = await import("@/server/db/client");
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", null, NOW);
    expect(r).toEqual({ allowed: true, source: "user" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("plataforma, dentro da cota → permite e incrementa", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 10,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", null, NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 11, quota: 4000 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "dono-1" },
      data: { aiCreditMonth: "2026-06", aiCreditUsed: 11 },
    });
  });

  it("plataforma, cota estourada → bloqueia e NÃO incrementa", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 4000,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", null, NOW);
    expect(r).toEqual({ allowed: false, used: 4000, quota: 4000 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("plataforma, mês virou → zera e conta o 1º do mês novo", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-05", aiCreditUsed: 300,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", null, NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 1, quota: 4000 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "dono-1" },
      data: { aiCreditMonth: "2026-06", aiCreditUsed: 1 },
    });
  });

  it("plano null (grandfather) → ilimitado, não conta", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: null });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", null, NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 0, quota: Infinity });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("admin da plataforma → ilimitado", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "admin@exemplo.com", plan: "INICIAL" });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("admin-1", null, NOW);
    expect(r.allowed).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("consumeAiCredit (peso por modelo)", () => {
  beforeEach(() => vi.clearAllMocks());
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("modelo strong cobra STRONG_CREDIT_WEIGHT créditos", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-06", aiCreditUsed: 100,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", "gpt-4o", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 110, quota: 10000 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "dono-1" },
      data: { aiCreditMonth: "2026-06", aiCreditUsed: 110 },
    });
  });

  it("cheap (ou sem modelo) cobra 1", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 0,
    });
    const { consumeAiCredit } = await import("./entitlements");
    expect(await consumeAiCredit("dono-1", "gpt-4o-mini", NOW)).toMatchObject({ used: 1 });
    expect(await consumeAiCredit("dono-1", null, NOW)).toMatchObject({ used: 1 });
  });

  it("bloqueia se o peso não cabe no que resta (não cobra parcial)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-06", aiCreditUsed: 9995,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", "gpt-4o", NOW); // 9995 + 10 > 10000
    expect(r).toEqual({ allowed: false, used: 9995, quota: 10000 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("resolveAiModelForUser (clamp por plano)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("plano sem strong → modelo strong vira null (cai no padrão econômico)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "gpt-4o")).toBeNull();
  });

  it("plano pago na chave da plataforma → strong vira null (strong só via BYOK)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "ESCALA" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "gpt-4o")).toBeNull();
  });

  it("grandfather (plan null) → mantém strong (exceção intencional do admin)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: null });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "gpt-4o")).toBe("gpt-4o");
  });

  it("BYOK → mantém qualquer modelo (sem clamp)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "user" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("plano comercial na plataforma → override por número é ignorado (sempre null = econômico)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    const { resolveAiModelForUser } = await import("./entitlements");
    // Mesmo um modelo cheap-tier mais caro que o mini (gpt-4.1-mini) é descartado.
    expect(await resolveAiModelForUser("dono-1", "gpt-4o-mini")).toBeNull();
    expect(await resolveAiModelForUser("dono-1", "gpt-4.1-mini")).toBeNull();
  });
});

describe("canUseDelivery / canSellOnline (add-on de delivery)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("libera com o add-on ativo (mesmo no Inicial)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      plan: "INICIAL", email: "a@b.com", deliveryAddon: true,
    });
    const { canUseDelivery, canSellOnline } = await import("./entitlements");
    expect(await canUseDelivery("u1")).toBe(true);
    expect(await canSellOnline("u1")).toBe(true);
  });

  it("bloqueia sem o add-on — inclusive Profissional+ (add-on NÃO vem incluso no plano)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      plan: "PROFISSIONAL", email: "a@b.com", deliveryAddon: false,
    });
    const { canUseDelivery, canSellOnline } = await import("./entitlements");
    expect(await canUseDelivery("u1")).toBe(false);
    expect(await canSellOnline("u1")).toBe(false);
  });

  it("bloqueia no Inicial sem add-on", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      plan: "INICIAL", email: "a@b.com", deliveryAddon: false,
    });
    const { canUseDelivery } = await import("./entitlements");
    expect(await canUseDelivery("u1")).toBe(false);
  });

  it("libera grandfather (plan null) sem add-on", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      plan: null, email: "a@b.com", deliveryAddon: false,
    });
    const { canUseDelivery } = await import("./entitlements");
    expect(await canUseDelivery("u1")).toBe(true);
  });

  it("libera admin mesmo no Inicial sem add-on", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      plan: "INICIAL", email: "admin@exemplo.com", deliveryAddon: false,
    });
    const { canUseDelivery } = await import("./entitlements");
    expect(await canUseDelivery("u1")).toBe(true);
  });

  it("bloqueia quando a conta não existe", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    const { canUseDelivery, canSellOnline } = await import("./entitlements");
    expect(await canUseDelivery("u1")).toBe(false);
    expect(await canSellOnline("u1")).toBe(false);
  });
});

describe("getAiUsageStatus", () => {
  beforeEach(() => vi.clearAllMocks());
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("BYOK → ilimitado", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "user" });
    const { getAiUsageStatus } = await import("./entitlements");
    expect(await getAiUsageStatus("dono-1", NOW)).toEqual({ unlimited: true, reason: "byok" });
  });

  it("plataforma com plano → used/quota do mês corrente", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-06", aiCreditUsed: 420,
    });
    const { getAiUsageStatus } = await import("./entitlements");
    expect(await getAiUsageStatus("dono-1", NOW)).toEqual({
      unlimited: false, used: 420, quota: 10000, month: "2026-06",
    });
  });

  it("plataforma, mês virou → used=0 (não vaza o mês anterior)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-05", aiCreditUsed: 1500,
    });
    const { getAiUsageStatus } = await import("./entitlements");
    expect(await getAiUsageStatus("dono-1", NOW)).toMatchObject({ used: 0, quota: 10000 });
  });
});
