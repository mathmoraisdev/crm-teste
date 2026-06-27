import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ADMIN_EMAILS = "admin@exemplo.com";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

describe("isAccountActiveByLead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true quando a conta dona do lead está ativa", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({ user: { billingActive: true } });
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("lead-1")).toBe(true);
  });

  it("false quando a conta está suspensa", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({ user: { billingActive: false } });
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("lead-2")).toBe(false);
  });

  it("false (fail-safe) quando o lead não existe", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue(null);
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("nao-existe")).toBe(false);
  });
});

describe("setAccountBilling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa suspender uma conta admin", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-admin",
      email: "admin@exemplo.com",
    });
    const { setAccountBilling } = await import("./account.service");
    await expect(setAccountBilling("u-admin", false)).rejects.toThrow(/admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("ativa/suspende uma conta comum", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli", billingActive: false });
    const { setAccountBilling } = await import("./account.service");
    await setAccountBilling("u-cli", false);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-cli" },
      data: { billingActive: false },
      select: { id: true, billingActive: true },
    });
  });
});
