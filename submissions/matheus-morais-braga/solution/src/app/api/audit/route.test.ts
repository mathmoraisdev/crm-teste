import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/lib/tenant", () => ({
  getTenantContext: vi.fn(),
}));

vi.mock("@/server/services/audit.service", () => ({
  listAudit: vi.fn(),
}));

function reqWith(query = "") {
  return { nextUrl: { searchParams: new URLSearchParams(query) } } as any;
}

describe("GET /api/audit — gate de ADMIN", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não autenticado → 401", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(reqWith());
    expect(res.status).toBe(401);
  });

  it("operador → 403 (auditoria é só do ADMIN)", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue({ sessionUserId: "op-1", tenantUserId: "dono-1", role: "OPERADOR" });
    const { GET } = await import("./route");
    const res = await GET(reqWith());
    expect(res.status).toBe(403);
  });

  it("ADMIN → 200 e escopa por tenantUserId", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue({ sessionUserId: "dono-1", tenantUserId: "dono-1", role: "ADMIN" });
    const { listAudit } = await import("@/server/services/audit.service");
    (listAudit as any).mockResolvedValue({ items: [], nextCursor: null });
    const { GET } = await import("./route");
    const res = await GET(reqWith("entityType=Lead"));
    expect(res.status).toBe(200);
    expect((listAudit as any).mock.calls[0][0]).toBe("dono-1");
    expect((listAudit as any).mock.calls[0][1].entityType).toBe("Lead");
  });
});
