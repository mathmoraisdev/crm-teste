import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

// Stubs de prisma/quota (Task 5.1): a lógica de chip/dedupe/quota é testável sem DB.
const db = {
  whatsAppNumber: { findFirst: vi.fn() },
  lead: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
  },
  user: { findUnique: vi.fn() },
};
vi.mock("@/server/db/client", () => ({ prisma: db }));
vi.mock("@/server/cache/keys", () => ({ invalidateLeadCaches: vi.fn() }));

async function subject() {
  const mod = await import("./lead.service");
  return mod.resolveOrCreatePublicLead;
}

const PHONE = "+5511987654321";

/** Conta ilimitada (plan=null) → assertContactQuota passa. */
function unlimitedAccount() {
  db.user.findUnique.mockResolvedValue({ plan: null, email: "dono@conta.test" });
}
/** Conta no teto: plan pago + contagem estourada → assertContactQuota lança. */
function quotaExceededAccount() {
  db.user.findUnique.mockResolvedValue({ plan: "INICIAL", email: "dono@conta.test" });
  db.lead.count.mockResolvedValue(10_000_000);
}

describe("resolveOrCreatePublicLead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria lead leve com o chip primário quando há (consentSource public_booking)", async () => {
    db.whatsAppNumber.findFirst.mockResolvedValue({ id: "chip1" });
    db.lead.findFirst.mockResolvedValue(null);
    unlimitedAccount();
    db.lead.create.mockResolvedValue({ id: "L1", name: "Ana" });

    const fn = await subject();
    const lead = await fn("acc1", { name: "Ana", phone: PHONE });

    expect(lead).toMatchObject({ id: "L1" });
    const data = db.lead.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "acc1",
      whatsAppNumberId: "chip1",
      phone: PHONE,
      name: "Ana",
      status: "NOVO",
      consentSource: "public_booking",
    });
  });

  it("deduplica por (whatsAppNumberId, phone) e atualiza o nome placeholder", async () => {
    db.whatsAppNumber.findFirst.mockResolvedValue({ id: "chip1" });
    db.lead.findFirst.mockResolvedValue({ id: "L9", name: PHONE }); // nome ainda é o telefone
    db.lead.update.mockResolvedValue({ id: "L9", name: "Ana" });

    const fn = await subject();
    const lead = await fn("acc1", { name: "Ana", phone: PHONE });

    // dedupe pela identidade com chip
    expect(db.lead.findFirst.mock.calls[0][0].where).toMatchObject({
      whatsAppNumberId: "chip1",
      phone: PHONE,
    });
    expect(lead).toMatchObject({ id: "L9", name: "Ana" });
    expect(db.lead.create).not.toHaveBeenCalled();
  });

  it("sem chip: deduplica por (userId, phone) e reusa lead pré-existente", async () => {
    db.whatsAppNumber.findFirst.mockResolvedValue(null); // nenhum chip (conectado ou não)
    db.lead.findFirst.mockResolvedValue({ id: "L7", name: "Bea" }); // lead antigo (import)
    db.lead.findUniqueOrThrow.mockResolvedValue({ id: "L7", name: "Bea" });

    const fn = await subject();
    const lead = await fn("acc1", { name: "Bea", phone: PHONE });

    expect(db.lead.findFirst.mock.calls[0][0].where).toMatchObject({ userId: "acc1", phone: PHONE });
    expect(lead).toMatchObject({ id: "L7" });
    expect(db.lead.create).not.toHaveBeenCalled();
  });

  it("sem chip e sem lead pré-existente → cria lead solto (whatsAppNumberId null)", async () => {
    db.whatsAppNumber.findFirst.mockResolvedValue(null); // conta sem WhatsApp conectado
    db.lead.findFirst.mockResolvedValue(null);
    unlimitedAccount();
    db.lead.create.mockResolvedValue({ id: "L2", name: "Bea" });

    const fn = await subject();
    const lead = await fn("acc1", { name: "Bea", phone: PHONE });

    // vira contato de verdade (aparece em Leads/Clientes), só sem chip p/ lembrete
    expect(lead).toMatchObject({ id: "L2" });
    const data = db.lead.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "acc1",
      whatsAppNumberId: null,
      phone: PHONE,
      name: "Bea",
      status: "NOVO",
      consentSource: "public_booking",
    });
  });

  it("teto de contatos estourado → null (sinal de walk-in), sem criar lead", async () => {
    db.whatsAppNumber.findFirst.mockResolvedValue({ id: "chip1" });
    db.lead.findFirst.mockResolvedValue(null);
    quotaExceededAccount();

    const fn = await subject();
    const lead = await fn("acc1", { name: "Ana", phone: PHONE });

    expect(lead).toBeNull();
    expect(db.lead.create).not.toHaveBeenCalled();
  });

  it("telefone inválido → lança", async () => {
    const fn = await subject();
    await expect(fn("acc1", { name: "Ana", phone: "abc" })).rejects.toThrow(/inválido/i);
  });
});

describe("resolveOrCreateLightLead — variante walk-in interno (consentSource manual)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("walk-in com telefone → cria lead com consentSource 'manual'", async () => {
    db.whatsAppNumber.findFirst.mockResolvedValue({ id: "chip1" });
    db.lead.findFirst.mockResolvedValue(null);
    unlimitedAccount();
    db.lead.create.mockResolvedValue({ id: "L3", name: "Zé" });

    const mod = await import("./lead.service");
    const lead = await mod.resolveOrCreateLightLead("acc1", { name: "Zé", phone: PHONE }, "manual");

    expect(lead).toMatchObject({ id: "L3" });
    expect(db.lead.create.mock.calls[0][0].data).toMatchObject({
      userId: "acc1",
      whatsAppNumberId: "chip1",
      phone: PHONE,
      consentSource: "manual",
    });
  });
});
