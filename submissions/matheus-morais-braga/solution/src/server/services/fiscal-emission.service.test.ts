import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

let emissionOn = true;
vi.mock("@/lib/env", () => ({
  get env() {
    return { FISCAL_EMISSION: emissionOn, FISCAL_MAX_ATTEMPTS: 5, FISCAL_MOCK: true };
  },
}));
vi.mock("@/server/crypto", () => ({
  decryptSecret: (s: string) => s.replace("enc(", "").replace(")", ""),
}));

const emitNfce = vi.fn();
const getStatus = vi.fn();
vi.mock("@/server/fiscal/emitter", () => ({
  fiscalEmitterFor: () => ({ emitNfce, getStatus }),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    order: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
}));

async function db() {
  return (await import("@/server/db/client")).prisma as any;
}

const ACCT = {
  fiscalProvider: "FOCUS_NFE",
  fiscalKeyEnc: "enc(tok-123456789012)",
  fiscalEnv: "HOMOLOGACAO",
  fiscalSerie: 1,
  fiscalCnpj: null,
  fiscalDefaultNcm: "95069100",
  fiscalDefaultCfop: "5102",
};

function pendingOrder() {
  return {
    id: "o1",
    fiscalStatus: "PENDENTE",
    fiscalDocId: null,
    discountCents: null,
    surchargeCents: null,
    tipCents: null,
    customerName: "João",
    items: [{ nameSnapshot: "Bola", quantity: 2, unitPriceCents: 2500 }],
    account: ACCT,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  emissionOn = true;
});

describe("dispatchPendingFiscalEmissions", () => {
  it("kill-switch off → não faz nada", async () => {
    emissionOn = false;
    const prisma = await db();
    const { dispatchPendingFiscalEmissions } = await import("./fiscal-emission");
    const n = await dispatchPendingFiscalEmissions(new Date());
    expect(n).toBe(0);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("emite um PENDENTE: flip atômico p/ PROCESSANDO, chama o emissor, grava EMITIDA+chave+danfe", async () => {
    const prisma = await db();
    prisma.order.findMany.mockResolvedValue([pendingOrder()]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    emitNfce.mockResolvedValue({
      status: "EMITIDA", docId: "mock-o1", accessKey: "0".repeat(44), danfeUrl: "https://x/danfe/o1",
    });

    const { dispatchPendingFiscalEmissions } = await import("./fiscal-emission");
    const n = await dispatchPendingFiscalEmissions(new Date());
    expect(n).toBe(1);

    // flip atômico
    const flip = prisma.order.updateMany.mock.calls[0][0];
    expect(flip.where).toEqual({ id: "o1", fiscalStatus: "PENDENTE" });
    expect(flip.data.fiscalStatus).toBe("PROCESSANDO");
    expect(flip.data.fiscalAttempts).toEqual({ increment: 1 });

    // emissor recebeu total derivado (2 × 2500 = 5000) e a ref
    expect(emitNfce).toHaveBeenCalledOnce();
    expect(emitNfce.mock.calls[0][0].totalCents).toBe(5000);
    expect(emitNfce.mock.calls[0][0].externalReference).toBe("o1");

    // gravação do resultado
    const upd = prisma.order.update.mock.calls[0][0];
    expect(upd.data.fiscalStatus).toBe("EMITIDA");
    expect(upd.data.fiscalKey).toBe("0".repeat(44));
    expect(upd.data.fiscalDanfeUrl).toBe("https://x/danfe/o1");
    expect(upd.data.fiscalIssuedAt).toBeInstanceOf(Date);
  });

  it("flip que afeta 0 linhas (outro worker pegou) → não chama o emissor", async () => {
    const prisma = await db();
    prisma.order.findMany.mockResolvedValue([pendingOrder()]);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    const { dispatchPendingFiscalEmissions } = await import("./fiscal-emission");
    await dispatchPendingFiscalEmissions(new Date());
    expect(emitNfce).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("PROCESSANDO → re-consulta getStatus e aplica o resultado", async () => {
    const prisma = await db();
    prisma.order.findMany.mockResolvedValue([
      { ...pendingOrder(), fiscalStatus: "PROCESSANDO", fiscalDocId: "mock-o1" },
    ]);
    getStatus.mockResolvedValue({ status: "EMITIDA", docId: "mock-o1", accessKey: "9".repeat(44) });

    const { dispatchPendingFiscalEmissions } = await import("./fiscal-emission");
    await dispatchPendingFiscalEmissions(new Date());
    expect(getStatus).toHaveBeenCalledWith("tok-123456789012", "HOMOLOGACAO", "mock-o1");
    expect(emitNfce).not.toHaveBeenCalled();
    expect(prisma.order.update.mock.calls[0][0].data.fiscalStatus).toBe("EMITIDA");
  });

  it("erro do emissor → volta a comanda p/ PENDENTE (próximo tick tenta)", async () => {
    const prisma = await db();
    prisma.order.findMany.mockResolvedValue([pendingOrder()]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    emitNfce.mockRejectedValue(new Error("rede caiu"));

    const { dispatchPendingFiscalEmissions } = await import("./fiscal-emission");
    await dispatchPendingFiscalEmissions(new Date());
    // 1ª updateMany = flip; 2ª = rollback p/ PENDENTE
    const rollback = prisma.order.updateMany.mock.calls[1][0];
    expect(rollback.where).toEqual({ id: "o1", fiscalStatus: "PROCESSANDO" });
    expect(rollback.data.fiscalStatus).toBe("PENDENTE");
  });
});

describe("retryFiscalEmission", () => {
  it("re-enfileira ERRO abaixo do teto: volta a PENDENTE, escopado por conta, limpa erro", async () => {
    const prisma = await db();
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    const { retryFiscalEmission } = await import("./fiscal-emission");
    await retryFiscalEmission("acc1", "o1");
    const call = prisma.order.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: "o1", accountId: "acc1", fiscalStatus: "ERRO", fiscalAttempts: { lt: 5 },
    });
    expect(call.data).toEqual({ fiscalStatus: "PENDENTE", fiscalError: null });
  });

  it("nada casa (status != ERRO ou teto atingido) → erro amigável", async () => {
    const prisma = await db();
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    const { retryFiscalEmission } = await import("./fiscal-emission");
    await expect(retryFiscalEmission("acc1", "o1")).rejects.toThrow(/não é possível reemitir/i);
  });
});
