import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.PAGBANK_BASE_URL = "https://pagbank.test";
  process.env.APP_PUBLIC_URL = "https://app.test";
});

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("pagBankGateway", () => {
  it("createPixCharge manda valor em CENTAVOS e extrai o copia-e-cola", async () => {
    const { pagBankGateway } = await import("./pagbank");
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        id: "ORDE_ABC",
        qr_codes: [
          {
            id: "QRCO_1",
            text: "000201PAGBANK",
            links: [
              { media: "image/png", href: "https://pagbank.test/qr.png" },
              { media: "text/plain", href: "https://pagbank.test/qr.txt" },
            ],
          },
        ],
      }),
    );

    const charge = await pagBankGateway.createPixCharge({
      apiKey: "tok_pb",
      amountCents: 5700,
      description: "Comanda #12",
      externalReference: "sale_9",
      payerName: "João",
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://pagbank.test/orders");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok_pb");
    const sent = JSON.parse(opts.body);
    // PagBank usa CENTAVOS (inteiro) — NÃO dividir por 100.
    expect(sent.qr_codes[0].amount.value).toBe(5700);
    expect(sent.reference_id).toBe("sale_9");
    expect(sent.notification_urls[0]).toBe("https://app.test/api/webhooks/payment/pagbank");

    expect(charge.providerChargeId).toBe("ORDE_ABC"); // guardamos o id do PEDIDO
    expect(charge.pixCopiaECola).toBe("000201PAGBANK");
  });

  it("isChargePaid = true quando alguma charge está PAID", async () => {
    const { pagBankGateway } = await import("./pagbank");
    fetchMock.mockResolvedValueOnce(jsonRes({ charges: [{ status: "PAID" }] }));
    expect(await pagBankGateway.isChargePaid("tok", "ORDE_ABC")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({ charges: [{ status: "WAITING" }] }));
    expect(await pagBankGateway.isChargePaid("tok", "ORDE_ABC")).toBe(false);
    fetchMock.mockResolvedValueOnce(jsonRes({})); // sem charges ainda
    expect(await pagBankGateway.isChargePaid("tok", "ORDE_ABC")).toBe(false);
  });

  it("verifyCredential: 401/403 = inválido; 200/404 = válido", async () => {
    const { pagBankGateway } = await import("./pagbank");
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 401));
    expect(await pagBankGateway.verifyCredential("tok")).toBe(false);
    fetchMock.mockResolvedValueOnce(jsonRes({}, true, 200));
    expect(await pagBankGateway.verifyCredential("tok")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 404));
    expect(await pagBankGateway.verifyCredential("tok")).toBe(true); // autenticado, só não achou
  });

  it("parseWebhookChargeId extrai o id do pedido (root)", async () => {
    const { pagBankGateway } = await import("./pagbank");
    expect(pagBankGateway.parseWebhookChargeId({ id: "ORDE_ABC", charges: [{ status: "PAID" }] })).toBe("ORDE_ABC");
    expect(pagBankGateway.parseWebhookChargeId({})).toBeNull();
  });
});
