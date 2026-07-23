// src/server/services/user.service.register.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

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
vi.mock("@/lib/env", () => ({ env: { TRIAL_DAYS: 7 } }));

describe("registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("cria conta NOVA com trial de 7 dias (AUTO + accessUntil futuro)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: "u-1", sessionEpoch: 0 });
    const { registerUser } = await import("./user.service");
    await registerUser({ name: "Cliente", email: "c@x.com", password: "12345678" });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data.billingOverride).toBe("AUTO");
    expect(arg.data.accessUntil).toEqual(new Date("2026-07-04T12:00:00Z"));
  });

  it("conta nova nasce com plano INICIAL (trial capado, cheap-only)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: "u-1", sessionEpoch: 0 });
    const { registerUser } = await import("./user.service");
    await registerUser({ name: "X", email: "novo@x.com", password: "12345678" });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data.plan).toBe("INICIAL");
  });
});
