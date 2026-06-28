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

    const r = await consumeAiCredit("dono-1", NOW);
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

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 11, quota: 300 });
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
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 300,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: false, used: 300, quota: 300 });
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

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 1, quota: 300 });
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

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 0, quota: Infinity });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("admin da plataforma → ilimitado", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "admin@exemplo.com", plan: "INICIAL" });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("admin-1", NOW);
    expect(r.allowed).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
