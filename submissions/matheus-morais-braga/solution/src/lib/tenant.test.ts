import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe("resolveTenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dono: tenantUserId = próprio id e perms totais (ignora flags)", async () => {
    const { prisma } = await import("@/server/db/client");
    // Mesmo com flags restritivas no registro, o ADMIN sempre tem acesso total.
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "dono-1",
      ownerId: null,
      role: "ADMIN",
      canCampaigns: false,
      canSettings: false,
      canFinance: false,
      leadsScope: "ASSIGNED",
    });
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("dono-1")).toEqual({
      sessionUserId: "dono-1",
      tenantUserId: "dono-1",
      role: "ADMIN",
      perms: { canCampaigns: true, canSettings: true, canFinance: true, leadsScope: "ALL" },
    });
  });

  it("operador: tenantUserId = ownerId e perms vindas do registro", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "op-1",
      ownerId: "dono-1",
      role: "OPERADOR",
      canCampaigns: false,
      canSettings: true,
      canFinance: false,
      leadsScope: "ASSIGNED",
    });
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("op-1")).toEqual({
      sessionUserId: "op-1",
      tenantUserId: "dono-1",
      role: "OPERADOR",
      perms: { canCampaigns: false, canSettings: true, canFinance: false, leadsScope: "ASSIGNED" },
    });
  });

  it("usuário inexistente: null", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("ghost")).toBeNull();
  });
});
