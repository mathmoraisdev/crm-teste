// src/server/services/account.service.test.ts
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
    payment: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const FUTURE = new Date("2026-07-10T12:00:00Z");
const PAST = new Date("2026-06-01T12:00:00Z");

describe("isAccountActiveByLead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true quando a conta dona do lead tem acesso no futuro (AUTO)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({
      user: { billingOverride: "AUTO", accessUntil: FUTURE },
    });
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("lead-1")).toBe(true);
  });

  it("false quando o acesso venceu (AUTO + data passada)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({
      user: { billingOverride: "AUTO", accessUntil: PAST },
    });
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

describe("setAccountAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa suspender (override SUSPENDED) uma conta admin", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u-admin", email: "admin@exemplo.com" });
    const { setAccountAccess } = await import("./account.service");
    await expect(
      setAccountAccess("u-admin", { kind: "forceSuspend" }),
    ).rejects.toThrow(/admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("estende N dias e zera override p/ AUTO", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: null,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", { kind: "extend", days: 60 });
    const arg = (prisma.user.update as any).mock.calls[0][0];
    expect(arg.data.billingOverride).toBe("AUTO");
    expect(arg.data.accessUntil).toBeInstanceOf(Date);
  });

  it("força ativo (override ACTIVE) sem mexer na data", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: PAST,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", { kind: "forceActive" });
    const arg = (prisma.user.update as any).mock.calls[0][0];
    expect(arg.data.billingOverride).toBe("ACTIVE");
    expect(arg.data).not.toHaveProperty("accessUntil");
  });

  it("lançar pagamento COM vencimento libera acesso até a data (AUTO)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: null,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", {
      kind: "setInfo",
      paymentMethod: "PIX",
      paymentDueDate: FUTURE,
      amountCents: null,
    });
    const arg = (prisma.user.update as any).mock.calls[0][0];
    expect(arg.data.paymentMethod).toBe("PIX");
    expect(arg.data.paymentDueDate).toBe(FUTURE);
    expect(arg.data.billingOverride).toBe("AUTO");
    expect(arg.data.accessUntil).toBe(FUTURE);
  });

  it("lançar pagamento SEM vencimento é só anotação (não mexe no acesso)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: PAST,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", {
      kind: "setInfo",
      paymentMethod: "PIX",
      paymentDueDate: null,
      amountCents: null,
    });
    const arg = (prisma.user.update as any).mock.calls[0][0];
    expect(arg.data.paymentMethod).toBe("PIX");
    expect(arg.data).not.toHaveProperty("billingOverride");
    expect(arg.data).not.toHaveProperty("accessUntil");
  });

  it("setInfo COM valor cria Payment + estende acesso (transação)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u-cli", email: "c@x.com", accessUntil: null });
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({
        user: { update: vi.fn().mockResolvedValue({ id: "u-cli" }) },
        payment: { create: vi.fn().mockResolvedValue({ id: "pay-1" }) },
      }),
    );
    const { setAccountAccess } = await import("./account.service");
    const due = new Date("2026-07-27T12:00:00Z");
    await setAccountAccess("u-cli", {
      kind: "setInfo", paymentMethod: "PIX", paymentDueDate: due, amountCents: 12990,
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("setInfo SEM valor não cria Payment (só update da conta)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u-cli", email: "c@x.com", accessUntil: null });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", {
      kind: "setInfo", paymentMethod: "PIX", paymentDueDate: null, amountCents: null,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
