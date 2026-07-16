import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/server/db/client", () => ({ prisma: { catalogItem: { findMany: vi.fn() } } }));

describe("stockValuation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("soma saldo×custo dos itens rastreados e conta os sem custo", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.catalogItem.findMany as any).mockResolvedValue([
      { id: "a", name: "A", stockQty: 5, costCents: 200, priceCents: 500 }, // valor 1000
      { id: "b", name: "B", stockQty: 3, costCents: null, priceCents: 900 }, // sem custo → 0, contado
    ]);
    const { stockValuation } = await import("./stock-valuation.service");
    const r = await stockValuation("u1");
    expect(r.totalValueCents).toBe(1000);
    expect(r.withoutCostCount).toBe(1);
    expect(r.items.find((i) => i.id === "a")!.valueCents).toBe(1000);
    // margem potencial por item (preço−custo)/preço em bps
    expect(r.items.find((i) => i.id === "a")!.marginBps).toBe(6000);
  });
});
