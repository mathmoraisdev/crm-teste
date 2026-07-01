import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    whatsAppNumber: { findFirst: vi.fn() },
    offer: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Gate mockado: por padrão libera; um teste força a negativa.
vi.mock("@/server/services/entitlements", () => ({
  assertFeature: vi.fn().mockResolvedValue(undefined),
}));

async function db() {
  return (await import("@/server/db/client")).prisma as any;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { assertFeature } = await import("@/server/services/entitlements");
  (assertFeature as any).mockResolvedValue(undefined);
});

describe("createOffer", () => {
  it("exige a feature sales e grava priceCents/active", async () => {
    const prisma = await db();
    prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: "n1" });
    prisma.offer.create.mockResolvedValue({
      id: "off_1", whatsAppNumberId: "n1", name: "Mentoria", description: "Plano", priceCents: 19700, active: true,
    });
    const { createOffer } = await import("./offer.service");
    const { assertFeature } = await import("@/server/services/entitlements");

    const r = await createOffer("u1", { whatsAppNumberId: "n1", name: "Mentoria", description: "Plano", priceCents: 19700 });
    expect(assertFeature).toHaveBeenCalledWith("u1", "sales");
    expect(prisma.offer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u1", priceCents: 19700 }) }),
    );
    expect(r.priceCents).toBe(19700);
    expect(r.active).toBe(true);
  });

  it("rejeita preço abaixo de R$1,00", async () => {
    const prisma = await db();
    prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: "n1" });
    const { createOffer } = await import("./offer.service");
    await expect(
      createOffer("u1", { whatsAppNumberId: "n1", name: "X", priceCents: 50 }),
    ).rejects.toThrow();
  });

  it("bloqueia número de outro dono (isolamento)", async () => {
    const prisma = await db();
    prisma.whatsAppNumber.findFirst.mockResolvedValue(null);
    const { createOffer } = await import("./offer.service");
    await expect(
      createOffer("u1", { whatsAppNumberId: "alheio", name: "X", priceCents: 19700 }),
    ).rejects.toThrow("Número não encontrado.");
  });

  it("propaga a negativa do gate de plano", async () => {
    const { assertFeature } = await import("@/server/services/entitlements");
    (assertFeature as any).mockRejectedValue(new Error("Seu plano não inclui"));
    const { createOffer } = await import("./offer.service");
    await expect(
      createOffer("u1", { whatsAppNumberId: "n1", name: "X", priceCents: 19700 }),
    ).rejects.toThrow("Seu plano não inclui");
  });
});

describe("listActiveOffers", () => {
  it("filtra active: true pelo número", async () => {
    const prisma = await db();
    prisma.offer.findMany.mockResolvedValue([
      { id: "off_1", whatsAppNumberId: "n1", name: "A", description: null, priceCents: 100, active: true },
    ]);
    const { listActiveOffers } = await import("./offer.service");
    const r = await listActiveOffers("n1");
    expect(prisma.offer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { whatsAppNumberId: "n1", active: true } }),
    );
    expect(r).toHaveLength(1);
  });
});

describe("updateOffer/deleteOffer", () => {
  it("updateOffer valida que a oferta é do dono", async () => {
    const prisma = await db();
    prisma.offer.findFirst.mockResolvedValue(null);
    const { updateOffer } = await import("./offer.service");
    await expect(updateOffer("u1", "off_x", { active: false })).rejects.toThrow("Oferta não encontrada.");
  });

  it("deleteOffer valida que a oferta é do dono", async () => {
    const prisma = await db();
    prisma.offer.findFirst.mockResolvedValue(null);
    const { deleteOffer } = await import("./offer.service");
    await expect(deleteOffer("u1", "off_x")).rejects.toThrow("Oferta não encontrada.");
  });
});
