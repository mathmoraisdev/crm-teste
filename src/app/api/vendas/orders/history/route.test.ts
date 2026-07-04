import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "@/server/services/catalog.service";
import { openOrder, addItem, closeOrder } from "@/server/services/order.service";

// Auth: mockamos só o contexto de tenant; o resto (prisma/serviço) roda de verdade.
vi.mock("@/lib/tenant", () => ({ getTenantContext: vi.fn() }));

async function call(qs: string) {
  const { GET } = await import("./route");
  const req = new NextRequest(`http://localhost/api/vendas/orders/history?${qs}`);
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/vendas/orders/history (E2E extrato)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não autenticado → 401", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue(null);
    const { status } = await call("period=mes");
    expect(status).toBe(401);
  });

  it("operador por linha, filtro por operador, busca por nome e período custom", async () => {
    const acc = (await prisma.user.create({ data: { email: `e2e_dono_${Math.random()}@t.test`, name: "Dono E2E", passwordHash: "x" } })).id;
    const op = await prisma.user.create({ data: { email: `e2e_op_${Math.random()}@t.test`, name: "Bruno Operador", passwordHash: "x", ownerId: acc, role: "OPERADOR" } });
    const item = await createCatalogItem(acc, { name: "Serviço", priceCents: 5000 });

    const o1 = await openOrder(acc, { openedById: acc, customerName: "Carlos Dono" });
    await addItem(acc, o1.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o1.id, { payment: "DINHEIRO" });

    const o2 = await openOrder(acc, { openedById: op.id, customerName: "Diana Cliente" });
    await addItem(acc, o2.id, { catalogItemId: item.id, quantity: 3 });
    await closeOrder(acc, o2.id, { payment: "PIX" });

    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue({ sessionUserId: acc, tenantUserId: acc, role: "ADMIN" });

    // período custom cobrindo agora
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();

    // todas as comandas do período
    const all = await call(`from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    const carlos = all.body.items.find((r: any) => r.customerName === "Carlos Dono");
    expect(carlos.operatorName).toBe("Dono E2E");
    expect(carlos.totalCents).toBe(5000);
    const diana = all.body.items.find((r: any) => r.customerName === "Diana Cliente");
    expect(diana.operatorName).toBe("Bruno Operador");
    expect(diana.totalCents).toBe(15000);
    // operadores disponíveis p/ o filtro
    expect(all.body.operators.map((o: any) => o.name).sort()).toEqual(["Bruno Operador", "Dono E2E"]);

    // filtro por operador
    const byOp = await call(`from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&operatorId=${op.id}`);
    expect(byOp.body.items.map((r: any) => r.customerName)).toEqual(["Diana Cliente"]);

    // busca por nome do cliente (case-insensitive)
    const byName = await call(`from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&q=carlos`);
    expect(byName.body.items.map((r: any) => r.customerName)).toEqual(["Carlos Dono"]);
  });

  it("datas inválidas → 400", async () => {
    const { getTenantContext } = await import("@/lib/tenant");
    (getTenantContext as any).mockResolvedValue({ sessionUserId: "x", tenantUserId: "x", role: "ADMIN" });
    const { status } = await call("from=nope&to=nope");
    expect(status).toBe(400);
  });
});
