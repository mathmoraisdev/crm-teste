import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/lib/tenant", () => ({
  getTenantContext: vi.fn(),
  getTenantUserId: vi.fn(),
}));

describe("POST /api/numbers — gating por papel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita operador com 403 (gestão de números é do ADMIN)", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue({
      sessionUserId: "op-1",
      tenantUserId: "dono-1",
      role: "OPERADOR",
    });
    const { POST } = await import("./route");
    const res = await POST({} as any);
    expect(res.status).toBe(403);
  });

  it("não autenticado → 401", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST({} as any);
    expect(res.status).toBe(401);
  });
});
