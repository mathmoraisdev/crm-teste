import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock("@/lib/email", () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  sendEmail: vi.fn(),
}));

describe("registerUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria conta NOVA já suspensa (billingActive=false)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: "u-1", sessionEpoch: 0 });
    const { registerUser } = await import("./user.service");
    await registerUser({ name: "Cliente", email: "c@x.com", password: "12345678" });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data.billingActive).toBe(false);
  });
});
