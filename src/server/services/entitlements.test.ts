import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ADMIN_EMAILS = "admin@exemplo.com";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
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
