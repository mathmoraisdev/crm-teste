// src/server/services/payment.service.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
beforeAll(() => { process.env.DATABASE_URL ||= "postgresql://t:t@localhost:5432/t?schema=public"; });
vi.mock("@/server/db/client", () => ({
  prisma: { payment: { aggregate: vi.fn(), findMany: vi.fn() } },
}));

describe("revenueCents", () => {
  beforeEach(() => vi.clearAllMocks());
  it("soma o período e trata vazio como 0", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.payment.aggregate as any).mockResolvedValue({ _sum: { amountCents: null } });
    const { revenueCents } = await import("./payment.service");
    expect(await revenueCents(new Date("2026-06-01"), new Date("2026-07-01"))).toBe(0);
    const arg = (prisma.payment.aggregate as any).mock.calls[0][0];
    expect(arg.where.paidAt.gte).toEqual(new Date("2026-06-01"));
    expect(arg.where.paidAt.lt).toEqual(new Date("2026-07-01"));
  });
});

describe("listPayments", () => {
  beforeEach(() => vi.clearAllMocks());
  it("achata account.name/email na linha", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.payment.findMany as any).mockResolvedValue([
      { id: "p1", accountId: "u1", amountCents: 12990, method: "PIX",
        paidAt: new Date("2026-06-10"), coversUntil: null,
        account: { name: "Cliente X", email: "x@y.com" } },
    ]);
    const { listPayments } = await import("./payment.service");
    const rows = await listPayments(new Date("2026-06-01"), new Date("2026-07-01"));
    expect(rows[0]).toMatchObject({ accountName: "Cliente X", accountEmail: "x@y.com", amountCents: 12990 });
  });
});
