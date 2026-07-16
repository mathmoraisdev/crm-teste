import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
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

describe("focusNfeEmitter", () => {
  it("emitNfce faz POST com ref, converte dinheiro e mapeia autorizado → EMITIDA", async () => {
    const { focusNfeEmitter } = await import("./focus-nfe");
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        status: "autorizado",
        chave_nfe: "3".repeat(44),
        caminho_danfe: "/danfe/abc.pdf",
      }),
    );

    const r = await focusNfeEmitter.emitNfce({
      apiKey: "tok_focus_123456",
      fiscalEnv: "HOMOLOGACAO",
      serie: 1,
      externalReference: "order_1",
      totalCents: 5000,
      items: [{ name: "Bola", quantity: 2, unitPriceCents: 2500 }],
      defaultNcm: "95069100",
      defaultCfop: "5102",
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://homologacao.focusnfe.com.br/v2/nfce?ref=order_1");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toContain("Basic ");
    const sent = JSON.parse(opts.body);
    expect(sent.items[0].valor_unitario_comercial).toBe("25.00"); // centavos → reais
    expect(sent.items[0].valor_bruto).toBe("50.00");
    expect(sent.items[0].codigo_ncm).toBe("95069100"); // cai no default
    expect(sent.items[0].cfop).toBe("5102");

    expect(r.status).toBe("EMITIDA");
    expect(r.accessKey).toBe("3".repeat(44));
    expect(r.danfeUrl).toBe("https://homologacao.focusnfe.com.br/danfe/abc.pdf");
    expect(r.docId).toBe("order_1");
  });

  it("emitNfce mapeia processando_autorizacao → PROCESSANDO", async () => {
    const { focusNfeEmitter } = await import("./focus-nfe");
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "processando_autorizacao" }));
    const r = await focusNfeEmitter.emitNfce({
      apiKey: "tok_focus_123456",
      fiscalEnv: "HOMOLOGACAO",
      serie: 1,
      externalReference: "order_2",
      totalCents: 1000,
      items: [{ name: "X", quantity: 1, unitPriceCents: 1000 }],
    });
    expect(r.status).toBe("PROCESSANDO");
    expect(r.docId).toBe("order_2");
  });

  it("emitNfce mapeia erro_autorizacao → ERRO com a mensagem da SEFAZ", async () => {
    const { focusNfeEmitter } = await import("./focus-nfe");
    fetchMock.mockResolvedValueOnce(
      jsonRes({ status: "erro_autorizacao", mensagem_sefaz: "NCM inválido" }),
    );
    const r = await focusNfeEmitter.emitNfce({
      apiKey: "tok_focus_123456",
      fiscalEnv: "HOMOLOGACAO",
      serie: 1,
      externalReference: "order_3",
      totalCents: 1000,
      items: [{ name: "X", quantity: 1, unitPriceCents: 1000 }],
    });
    expect(r.status).toBe("ERRO");
    expect(r.error).toBe("NCM inválido");
  });

  it("getStatus consulta /v2/nfce/{ref} e usa a base de produção", async () => {
    const { focusNfeEmitter } = await import("./focus-nfe");
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "autorizado", chave_nfe: "9".repeat(44) }));
    const r = await focusNfeEmitter.getStatus("tok_focus_123456", "PRODUCAO", "order_4");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.focusnfe.com.br/v2/nfce/order_4");
    expect(r.status).toBe("EMITIDA");
    expect(r.docId).toBe("order_4");
  });

  it("verifyCredential = 200 em /v2/empresas", async () => {
    const { focusNfeEmitter } = await import("./focus-nfe");
    fetchMock.mockResolvedValueOnce(jsonRes({}, true, 200));
    expect(await focusNfeEmitter.verifyCredential("tok_focus_123456", "HOMOLOGACAO")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 403));
    expect(await focusNfeEmitter.verifyCredential("tok_focus_123456", "HOMOLOGACAO")).toBe(false);
  });

  it("cancelNfce DELETE com justificativa → cancelado vira sucesso", async () => {
    const { focusNfeEmitter } = await import("./focus-nfe");
    fetchMock.mockResolvedValueOnce(jsonRes({ status: "cancelado" }));
    const r = await focusNfeEmitter.cancelNfce("tok_focus_123456", "HOMOLOGACAO", "order_5", "estorno");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://homologacao.focusnfe.com.br/v2/nfce/order_5");
    expect(opts.method).toBe("DELETE");
    expect(JSON.parse(opts.body).justificativa).toBe("estorno");
    expect(r.status).toBe("EMITIDA"); // sucesso do cancelamento
  });
});
