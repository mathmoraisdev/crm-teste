import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/services/sales.service", () => ({
  confirmPaymentByCharge: vi.fn().mockResolvedValue({ confirmed: true }),
}));

function req(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });

async function confirmMock() {
  return (await import("@/server/services/sales.service")).confirmPaymentByCharge as any;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/webhooks/payment/[provider]", () => {
  it("Mercado Pago: extrai data.id e confirma", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ type: "payment", data: { id: 123 } }), ctx("mercadopago"));
    expect(res.status).toBe(200);
    const confirm = await confirmMock();
    expect(confirm).toHaveBeenCalledWith("MERCADO_PAGO", "123");
  });

  it("Asaas: extrai payment.id e confirma", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ event: "PAYMENT_RECEIVED", payment: { id: "pay_9" } }), ctx("asaas"));
    expect(res.status).toBe(200);
    const confirm = await confirmMock();
    expect(confirm).toHaveBeenCalledWith("ASAAS", "pay_9");
  });

  it("corpo inválido → 200 sem efeito", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(null), ctx("asaas"));
    expect(res.status).toBe(200);
    const confirm = await confirmMock();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("erro no confirm não vaza → ainda 200", async () => {
    const confirm = await confirmMock();
    confirm.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(req({ type: "payment", data: { id: 5 } }), ctx("mercadopago"));
    expect(res.status).toBe(200);
  });
});
