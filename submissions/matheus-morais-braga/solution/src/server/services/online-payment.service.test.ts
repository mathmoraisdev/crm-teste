import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    order: { update: vi.fn() },
  },
}));
vi.mock("@/server/payments/resolve", () => ({ resolvePaymentForUser: vi.fn() }));
vi.mock("@/server/payments/gateway", () => ({ gatewayFor: vi.fn() }));

async function mods() {
  return {
    prisma: (await import("@/server/db/client")).prisma as any,
    resolve: (await import("@/server/payments/resolve")).resolvePaymentForUser as any,
    gatewayFor: (await import("@/server/payments/gateway")).gatewayFor as any,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createOnlinePixCharge", () => {
  it("cria cobrança com externalReference=order:<id> e grava no Order", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    const createPixCharge = vi.fn().mockResolvedValue({
      providerChargeId: "pay_123",
      pixCopiaECola: "000201...PIX",
      pixQrCodeBase64: "iVBORw0KG==",
    });
    m.gatewayFor.mockReturnValue({ createPixCharge });
    const { createOnlinePixCharge } = await import("./online-payment.service");

    const r = await createOnlinePixCharge("acc1", "orderABC", 2700, "Maria");
    expect(r).toEqual({ copiaECola: "000201...PIX", qrBase64: "iVBORw0KG==" });
    expect(createPixCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "tok",
        amountCents: 2700,
        externalReference: "order:orderABC",
        payerName: "Maria",
      }),
    );
    // Grava provider/chargeId/copiaECola no Order.
    expect(m.prisma.order.update).toHaveBeenCalledWith({
      where: { id: "orderABC" },
      data: {
        onlineChargeProvider: "ASAAS",
        onlineChargeId: "pay_123",
        onlinePixCopiaECola: "000201...PIX",
      },
    });
  });

  it("sem gateway configurado → lança PAY_OFF", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue(null);
    const { createOnlinePixCharge } = await import("./online-payment.service");
    await expect(createOnlinePixCharge("acc1", "o1", 1000, "Maria")).rejects.toThrow(/PAY_OFF/);
    expect(m.prisma.order.update).not.toHaveBeenCalled();
  });

  it("falha do gateway propaga e não grava no Order", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue({ provider: "MERCADO_PAGO", apiKey: "tok" });
    m.gatewayFor.mockReturnValue({ createPixCharge: vi.fn().mockRejectedValue(new Error("boom")) });
    const { createOnlinePixCharge } = await import("./online-payment.service");
    await expect(createOnlinePixCharge("acc1", "o1", 1000, "Maria")).rejects.toThrow("boom");
    expect(m.prisma.order.update).not.toHaveBeenCalled();
  });
});
