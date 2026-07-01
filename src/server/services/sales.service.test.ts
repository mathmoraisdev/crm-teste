import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    offer: { findFirst: vi.fn() },
    sale: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    lead: { update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("@/server/payments/resolve", () => ({ resolvePaymentForUser: vi.fn() }));
vi.mock("@/server/payments/gateway", () => ({ gatewayFor: vi.fn() }));
vi.mock("@/server/services/account.service", () => ({ isAccountActive: vi.fn() }));
vi.mock("./messaging", () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined) }));

const LEAD = { id: "lead1", phone: "+5511999", userId: "u1", name: "João", whatsAppNumberId: "n1" };

async function mods() {
  return {
    prisma: (await import("@/server/db/client")).prisma as any,
    resolve: (await import("@/server/payments/resolve")).resolvePaymentForUser as any,
    gatewayFor: (await import("@/server/payments/gateway")).gatewayFor as any,
    isAccountActive: (await import("@/server/services/account.service")).isAccountActive as any,
    sendWhatsAppMessage: (await import("./messaging")).sendWhatsAppMessage as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendOffer", () => {
  it("sem gateway configurado → não cobra (no_gateway)", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue(null);
    const { sendOffer } = await import("./sales.service");
    expect(await sendOffer(LEAD, "off1")).toEqual({ sent: false, reason: "no_gateway" });
    expect(m.prisma.sale.create).not.toHaveBeenCalled();
  });

  it("oferta inexistente/inativa → offer_invalid", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    m.prisma.offer.findFirst.mockResolvedValue(null);
    const { sendOffer } = await import("./sales.service");
    expect(await sendOffer(LEAD, "off1")).toEqual({ sent: false, reason: "offer_invalid" });
  });

  it("conta suspensa → não cobra (suspended)", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    m.prisma.offer.findFirst.mockResolvedValue({ id: "off1", name: "Mentoria", description: null, priceCents: 19700 });
    m.isAccountActive.mockResolvedValue(false);
    const { sendOffer } = await import("./sales.service");
    expect(await sendOffer(LEAD, "off1")).toEqual({ sent: false, reason: "suspended" });
    expect(m.prisma.sale.create).not.toHaveBeenCalled();
  });

  it("cobra: cria Sale, gera Pix, envia copia-e-cola e move p/ OFERTA_ENVIADA", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    m.prisma.offer.findFirst.mockResolvedValue({ id: "off1", name: "Mentoria", description: "Plano", priceCents: 19700 });
    m.isAccountActive.mockResolvedValue(true);
    m.prisma.sale.create.mockResolvedValue({ id: "sale1" });
    const createPixCharge = vi.fn().mockResolvedValue({ providerChargeId: "pay_9", pixCopiaECola: "000201PIX" });
    m.gatewayFor.mockReturnValue({ createPixCharge });
    const { sendOffer } = await import("./sales.service");

    const r = await sendOffer(LEAD, "off1");
    expect(r).toEqual({ sent: true, saleId: "sale1" });
    // preço veio do banco (snapshot), não da IA
    expect(m.prisma.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 19700, status: "PENDING" }) }),
    );
    // externalReference = Sale.id
    expect(createPixCharge).toHaveBeenCalledWith(expect.objectContaining({ externalReference: "sale1", amountCents: 19700 }));
    // grava o id real + copia-e-cola
    expect(m.prisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerChargeId: "pay_9", pixCopiaECola: "000201PIX" }) }),
    );
    // enviou o copia-e-cola
    const sentText = m.sendWhatsAppMessage.mock.calls[0][1];
    expect(sentText).toContain("000201PIX");
    // moveu o lead
    expect(m.prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "OFERTA_ENVIADA" } }),
    );
  });

  it("falha na cobrança → remove a Sale provisória (charge_failed)", async () => {
    const m = await mods();
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    m.prisma.offer.findFirst.mockResolvedValue({ id: "off1", name: "Mentoria", description: null, priceCents: 19700 });
    m.isAccountActive.mockResolvedValue(true);
    m.prisma.sale.create.mockResolvedValue({ id: "sale1" });
    m.gatewayFor.mockReturnValue({ createPixCharge: vi.fn().mockRejectedValue(new Error("boom")) });
    const { sendOffer } = await import("./sales.service");

    expect(await sendOffer(LEAD, "off1")).toEqual({ sent: false, reason: "charge_failed" });
    expect(m.prisma.sale.delete).toHaveBeenCalledWith({ where: { id: "sale1" } });
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe("confirmPaymentByCharge", () => {
  it("Sale inexistente → no-op (not_found)", async () => {
    const m = await mods();
    m.prisma.sale.findUnique.mockResolvedValue(null);
    const { confirmPaymentByCharge } = await import("./sales.service");
    expect(await confirmPaymentByCharge("ASAAS", "pay_x")).toEqual({ confirmed: false, reason: "not_found" });
  });

  it("já PAID → idempotente, não reconsulta", async () => {
    const m = await mods();
    m.prisma.sale.findUnique.mockResolvedValue({ id: "s1", userId: "u1", leadId: "lead1", status: "PAID", amountCents: 19700, offer: { name: "Mentoria" } });
    const { confirmPaymentByCharge } = await import("./sales.service");
    expect(await confirmPaymentByCharge("ASAAS", "pay_9")).toEqual({ confirmed: true, alreadyPaid: true });
    expect(m.resolve).not.toHaveBeenCalled();
  });

  it("API do gateway não confirma → não marca PAID (not_paid)", async () => {
    const m = await mods();
    m.prisma.sale.findUnique.mockResolvedValue({ id: "s1", userId: "u1", leadId: "lead1", status: "PENDING", amountCents: 19700, offer: { name: "Mentoria" } });
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    m.gatewayFor.mockReturnValue({ isChargePaid: vi.fn().mockResolvedValue(false) });
    const { confirmPaymentByCharge } = await import("./sales.service");
    expect(await confirmPaymentByCharge("ASAAS", "pay_9")).toEqual({ confirmed: false, reason: "not_paid" });
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("API confirma → marca PAID, move lead p/ PAGO e manda pós-venda", async () => {
    const m = await mods();
    m.prisma.sale.findUnique.mockResolvedValue({ id: "s1", userId: "u1", leadId: "lead1", status: "PENDING", amountCents: 19700, offer: { name: "Mentoria" } });
    m.resolve.mockResolvedValue({ provider: "ASAAS", apiKey: "tok" });
    m.gatewayFor.mockReturnValue({ isChargePaid: vi.fn().mockResolvedValue(true) });
    m.prisma.lead.findUnique.mockResolvedValue({ id: "lead1", phone: "+55", userId: "u1", whatsAppNumberId: "n1" });
    const { confirmPaymentByCharge } = await import("./sales.service");

    expect(await confirmPaymentByCharge("ASAAS", "pay_9")).toEqual({ confirmed: true });
    expect(m.prisma.$transaction).toHaveBeenCalled();
    expect(m.sendWhatsAppMessage).toHaveBeenCalled();
  });
});
