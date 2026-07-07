import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { update: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock("@/server/crypto", () => ({ encryptSecret: (s: string) => `enc(${s})` }));
vi.mock("@/lib/env", () => ({ isEncryptionConfigured: true, env: { FISCAL_MOCK: true } }));

let verifyResult = true;
vi.mock("@/server/fiscal/emitter", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fiscalEmitterFor: () => ({
    verifyCredential: vi.fn().mockImplementation(async () => verifyResult),
  }),
}));

async function db() {
  return (await import("@/server/db/client")).prisma as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyResult = true;
});

describe("saveFiscalCredential", () => {
  it("valida no emissor, cifra o token e grava last4 + verifiedAt", async () => {
    const prisma = await db();
    prisma.user.findUnique.mockResolvedValue({
      fiscalProvider: "FOCUS_NFE",
      fiscalKeyLast4: "3456",
      fiscalEnabled: false,
      fiscalKeyVerifiedAt: new Date(),
      fiscalEnv: "HOMOLOGACAO",
      fiscalSerie: 1,
      fiscalCnpj: null,
      fiscalDefaultNcm: null,
      fiscalDefaultCfop: null,
    });
    const { saveFiscalCredential } = await import("./fiscal-credential.service");
    await saveFiscalCredential("u1", "FOCUS_NFE", "token-abc-123456", "HOMOLOGACAO");
    const arg = prisma.user.update.mock.calls[0][0].data;
    expect(arg.fiscalKeyEnc).toBe("enc(token-abc-123456)");
    expect(arg.fiscalKeyLast4).toBe("3456");
    expect(arg.fiscalProvider).toBe("FOCUS_NFE");
    expect(arg.fiscalEnv).toBe("HOMOLOGACAO");
    expect(arg.fiscalKeyVerifiedAt).toBeInstanceOf(Date);
  });

  it("token curto → erro, não grava", async () => {
    const prisma = await db();
    const { saveFiscalCredential } = await import("./fiscal-credential.service");
    await expect(
      saveFiscalCredential("u1", "FOCUS_NFE", "curto", "HOMOLOGACAO"),
    ).rejects.toThrow(/inválido/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("token que não valida no emissor → erro amigável, não grava", async () => {
    const prisma = await db();
    verifyResult = false;
    const { saveFiscalCredential } = await import("./fiscal-credential.service");
    await expect(
      saveFiscalCredential("u1", "FOCUS_NFE", "token-abc-123456", "HOMOLOGACAO"),
    ).rejects.toThrow(/validar o token/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("setFiscalProfile", () => {
  it("ligar o opt-in sem credencial → erro, não grava", async () => {
    const prisma = await db();
    prisma.user.findUnique.mockResolvedValue({ fiscalProvider: null });
    const { setFiscalProfile } = await import("./fiscal-credential.service");
    await expect(setFiscalProfile("u1", { fiscalEnabled: true })).rejects.toThrow(
      /Configure o emissor/i,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("ligar o opt-in com credencial → grava", async () => {
    const prisma = await db();
    prisma.user.findUnique.mockResolvedValue({
      fiscalProvider: "FOCUS_NFE",
      fiscalKeyLast4: "3456",
      fiscalEnabled: true,
      fiscalKeyVerifiedAt: new Date(),
      fiscalEnv: "HOMOLOGACAO",
      fiscalSerie: 1,
      fiscalCnpj: null,
      fiscalDefaultNcm: null,
      fiscalDefaultCfop: null,
    });
    const { setFiscalProfile } = await import("./fiscal-credential.service");
    await setFiscalProfile("u1", { fiscalEnabled: true, fiscalSerie: 2 });
    expect(prisma.user.update).toHaveBeenCalledOnce();
    expect(prisma.user.update.mock.calls[0][0].data.fiscalSerie).toBe(2);
  });
});
