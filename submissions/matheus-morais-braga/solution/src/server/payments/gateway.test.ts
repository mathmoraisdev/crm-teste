import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ASAAS_BASE_URL = "https://asaas.test";
  process.env.MERCADOPAGO_BASE_URL = "https://mp.test";
  process.env.APP_PUBLIC_URL = "https://app.test";
});

/** Resposta fetch fake com json() e ok/status. */
function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gatewayFor", () => {
  it("mapeia o provider para a implementação certa", async () => {
    const { gatewayFor } = await import("./gateway");
    const { asaasGateway } = await import("./asaas");
    const { mercadoPagoGateway } = await import("./mercadopago");
    const { pagBankGateway } = await import("./pagbank");
    expect(gatewayFor("ASAAS")).toBe(asaasGateway);
    expect(gatewayFor("MERCADO_PAGO")).toBe(mercadoPagoGateway);
    expect(gatewayFor("PAGBANK")).toBe(pagBankGateway);
  });
});

describe("asaasGateway", () => {
  it("createPixCharge monta a request PIX e retorna o copia-e-cola", async () => {
    const { asaasGateway } = await import("./asaas");
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: "pay_1" })) // POST /v3/payments
      .mockResolvedValueOnce(jsonRes({ payload: "000201...", encodedImage: "iVBOR" })); // GET pixQrCode

    const charge = await asaasGateway.createPixCharge({
      apiKey: "tok_asaas",
      amountCents: 19700,
      description: "Mentoria",
      externalReference: "sale_1",
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://asaas.test/v3/payments");
    expect(opts.method).toBe("POST");
    expect(opts.headers.access_token).toBe("tok_asaas");
    const sent = JSON.parse(opts.body);
    expect(sent.billingType).toBe("PIX");
    expect(sent.value).toBe(197); // centavos → reais
    expect(sent.externalReference).toBe("sale_1");

    expect(fetchMock.mock.calls[1][0]).toBe("https://asaas.test/v3/payments/pay_1/pixQrCode");
    expect(charge).toEqual({
      providerChargeId: "pay_1",
      pixCopiaECola: "000201...",
      pixQrCodeBase64: "iVBOR",
    });
  });

  it("isChargePaid lê o status RECEIVED/CONFIRMED", async () => {
    const { asaasGateway } = await import("./asaas");
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "RECEIVED" }));
    expect(await asaasGateway.isChargePaid("tok", "pay_1")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "PENDING" }));
    expect(await asaasGateway.isChargePaid("tok", "pay_1")).toBe(false);
  });

  it("verifyCredential = 200 em /v3/myAccount", async () => {
    const { asaasGateway } = await import("./asaas");
    fetchMock.mockResolvedValueOnce(jsonRes({}, true, 200));
    expect(await asaasGateway.verifyCredential("tok")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 401));
    expect(await asaasGateway.verifyCredential("tok")).toBe(false);
  });

  it("parseWebhookChargeId extrai payment.id", async () => {
    const { asaasGateway } = await import("./asaas");
    expect(
      asaasGateway.parseWebhookChargeId({ event: "PAYMENT_RECEIVED", payment: { id: "pay_9" } }),
    ).toBe("pay_9");
    expect(asaasGateway.parseWebhookChargeId({})).toBeNull();
  });
});

describe("mercadoPagoGateway", () => {
  it("createPixCharge monta a request e extrai o qr_code", async () => {
    const { mercadoPagoGateway } = await import("./mercadopago");
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        id: 123,
        point_of_interaction: {
          transaction_data: { qr_code: "000201MP", qr_code_base64: "iVBOR" },
        },
      }),
    );

    const charge = await mercadoPagoGateway.createPixCharge({
      apiKey: "tok_mp",
      amountCents: 9700,
      description: "Consultoria",
      externalReference: "sale_2",
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mp.test/v1/payments");
    expect(opts.headers.Authorization).toBe("Bearer tok_mp");
    const sent = JSON.parse(opts.body);
    expect(sent.payment_method_id).toBe("pix");
    expect(sent.transaction_amount).toBe(97);
    expect(sent.external_reference).toBe("sale_2");
    expect(sent.notification_url).toBe("https://app.test/api/webhooks/payment/mercadopago");

    expect(charge).toEqual({
      providerChargeId: "123",
      pixCopiaECola: "000201MP",
      pixQrCodeBase64: "iVBOR",
    });
  });

  it("isChargePaid = true só quando approved", async () => {
    const { mercadoPagoGateway } = await import("./mercadopago");
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "approved" }));
    expect(await mercadoPagoGateway.isChargePaid("tok", "123")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "pending" }));
    expect(await mercadoPagoGateway.isChargePaid("tok", "123")).toBe(false);
  });

  it("verifyCredential = 200 em /v1/payment_methods", async () => {
    const { mercadoPagoGateway } = await import("./mercadopago");
    fetchMock.mockResolvedValueOnce(jsonRes([], true, 200));
    expect(await mercadoPagoGateway.verifyCredential("tok")).toBe(true);
  });

  it("parseWebhookChargeId extrai data.id (topic payment)", async () => {
    const { mercadoPagoGateway } = await import("./mercadopago");
    expect(mercadoPagoGateway.parseWebhookChargeId({ type: "payment", data: { id: 456 } })).toBe("456");
    expect(mercadoPagoGateway.parseWebhookChargeId({})).toBeNull();
  });
});
