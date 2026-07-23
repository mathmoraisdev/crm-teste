import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe("resolvePaymentForUser", () => {
  it("devolve provider + token decifrado quando configurado", async () => {
    const { prisma } = await import("@/server/db/client");
    const { encryptSecret } = await import("@/server/crypto");
    (prisma.user.findUnique as any).mockResolvedValue({
      paymentProvider: "ASAAS",
      paymentKeyEnc: encryptSecret("tok_123456789"),
    });
    const { resolvePaymentForUser } = await import("@/server/payments/resolve");
    const r = await resolvePaymentForUser("u1");
    expect(r).toEqual({ provider: "ASAAS", apiKey: "tok_123456789" });
  });

  it("devolve null quando não configurado (vendas desligadas)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      paymentProvider: null,
      paymentKeyEnc: null,
    });
    const { resolvePaymentForUser } = await import("@/server/payments/resolve");
    expect(await resolvePaymentForUser("u1")).toBeNull();
  });
});
