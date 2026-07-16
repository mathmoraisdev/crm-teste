import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regressão de gate (Task 5): operador com canFinance:false — mesmo com canSettings:true —
// precisa ser barrado (403) nas rotas financeiras. Cobre 2 representativas: estorno e despesas.
vi.mock("@/lib/tenant", () => ({ getTenantContext: vi.fn() }));

const OP_FIN_FALSE = {
  sessionUserId: "op-1",
  tenantUserId: "dono-1",
  role: "OPERADOR",
  // canSettings segue liberado; só o financeiro está negado.
  perms: { canCampaigns: true, canSettings: true, canFinance: false, leadsScope: "ALL" },
};

describe("gate financeiro exige canFinance (não basta canSettings)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("estorno de comanda: canFinance:false → 403", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue(OP_FIN_FALSE);
    const { POST } = await import("./orders/[id]/void/route");
    const req = new NextRequest("http://localhost/api/vendas/orders/o1/void", {
      method: "POST",
      body: JSON.stringify({ reason: "engano" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "o1" }) });
    expect(res.status).toBe(403);
  });

  it("criar despesa: canFinance:false → 403", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue(OP_FIN_FALSE);
    const { POST } = await import("./expenses/route");
    const req = new NextRequest("http://localhost/api/vendas/expenses", {
      method: "POST",
      body: JSON.stringify({ description: "x", amountCents: 100, dueDate: "2026-07-07" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
