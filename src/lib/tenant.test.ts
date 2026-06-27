import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe("resolveTenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dono: tenantUserId = próprio id", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "dono-1", ownerId: null, role: "ADMIN" });
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("dono-1")).toEqual({ sessionUserId: "dono-1", tenantUserId: "dono-1", role: "ADMIN" });
  });

  it("operador: tenantUserId = ownerId", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "op-1", ownerId: "dono-1", role: "OPERADOR" });
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("op-1")).toEqual({ sessionUserId: "op-1", tenantUserId: "dono-1", role: "OPERADOR" });
  });

  it("usuário inexistente: null", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("ghost")).toBeNull();
  });
});
