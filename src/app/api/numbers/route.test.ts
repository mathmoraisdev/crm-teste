import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
  // Determinismo: sem admins, o gating de plano não é bypassado por isAdminEmail.
  process.env.ADMIN_EMAILS = "";
});

vi.mock("@/lib/tenant", () => ({
  getTenantContext: vi.fn(),
  getTenantUserId: vi.fn(),
}));

vi.mock("@/server/services/numbers.service", () => ({
  listWhatsAppNumbers: vi.fn(),
  assertNumberQuota: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() }, whatsAppNumber: { upsert: vi.fn() } },
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

describe("GET /api/numbers — flags de plano", () => {
  beforeEach(() => vi.clearAllMocks());

  async function getBodyForPlan(plan: string | null) {
    const { getTenantUserId } = await import("@/lib/tenant");
    (getTenantUserId as any).mockResolvedValue("u1");
    const { listWhatsAppNumbers } = await import("@/server/services/numbers.service");
    (listWhatsAppNumbers as any).mockResolvedValue([]);
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: "OPENAI",
      email: "naoadmin@example.com",
      plan,
      paymentProvider: null,
    });
    const { GET } = await import("./route");
    const res = await GET();
    return res.json();
  }

  it("plano INICIAL não libera qualify/schedule", async () => {
    const body = await getBodyForPlan("INICIAL");
    expect(body.qualifyAllowed).toBe(false);
    expect(body.scheduleAllowed).toBe(false);
  });

  it("plano PROFISSIONAL libera qualify/schedule", async () => {
    const body = await getBodyForPlan("PROFISSIONAL");
    expect(body.qualifyAllowed).toBe(true);
    expect(body.scheduleAllowed).toBe(true);
  });

  it("sem plano (grandfather) libera tudo", async () => {
    const body = await getBodyForPlan(null);
    expect(body.qualifyAllowed).toBe(true);
    expect(body.scheduleAllowed).toBe(true);
    expect(body.salesAllowed).toBe(true);
  });
});
