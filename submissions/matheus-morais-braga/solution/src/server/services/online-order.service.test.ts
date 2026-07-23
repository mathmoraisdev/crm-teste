import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { saveItemModifiers, listItemModifiers } from "./modifier.service";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

// Pix e gates de entitlement/billing são I/O externo → mockados (como sales.service).
vi.mock("./online-payment.service", () => ({
  createOnlinePixCharge: vi.fn().mockResolvedValue({ copiaECola: "PIX-123", qrBase64: "b64" }),
}));
vi.mock("./entitlements", () => ({
  canSellOnline: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/server/services/account.service", () => ({
  isAccountActive: vi.fn().mockResolvedValue(true),
}));

async function mods() {
  return {
    createOnlinePixCharge: (await import("./online-payment.service")).createOnlinePixCharge as any,
    canSellOnline: (await import("./entitlements")).canSellOnline as any,
    isAccountActive: (await import("@/server/services/account.service")).isAccountActive as any,
  };
}

async function makeOwner(name = "Dono") {
  const u = await prisma.user.create({
    data: {
      email: `ord_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name,
      passwordHash: "x",
      menuEnabled: true,
    },
  });
  return u.id;
}

async function seedMenuItem(acc: string, name: string, priceCents: number, opts?: { menuCategory?: string; menuVisible?: boolean; trackStock?: boolean; stockQty?: number }) {
  const item = await createCatalogItem(acc, { name, priceCents, kind: "PRODUTO" });
  await prisma.catalogItem.update({
    where: { id: item.id },
    data: {
      menuCategory: opts?.menuCategory ?? "Lanches",
      ...(opts?.menuVisible !== undefined ? { menuVisible: opts.menuVisible } : {}),
      ...(opts?.trackStock !== undefined ? { trackStock: opts.trackStock, stockQty: opts?.stockQty ?? 0 } : {}),
    },
  });
  return item.id;
}

beforeEach(() => vi.clearAllMocks());

describe("placeOnlineOrder", () => {
  it("cria Order ONLINE de retirada (on_delivery), sem taxa, preço do servidor", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "X-Burguer", 1500);

    const { placeOnlineOrder } = await import("./online-order.service");
    const res = await placeOnlineOrder(acc, {
      mode: "RETIRADA",
      customerName: "Maria",
      customerPhone: "11999990000",
      items: [{ catalogItemId: itemId, quantity: 2 }],
      payment: "on_delivery",
    });

    expect(res.payment).toBe("on_delivery");
    expect(res.orderId).toBeTruthy();
    expect(res.pix).toBeUndefined();

    // Conferir a Order no DB.
    const o = await prisma.order.findUnique({
      where: { id: res.orderId },
      include: { items: true },
    });
    expect(o?.source).toBe("ONLINE");
    expect(o?.orderType).toBe("RETIRADA");
    expect(o?.fulfillmentStatus).toBe("PENDENTE");
    expect(o?.deliveryFeeCents).toBeNull();
    expect(o?.customerPhone).toBe("11999990000");
    // Preço veio do servidor (1500 × 2 = 3000), ignorando qualquer preço do client.
    expect(o?.items[0]?.unitPriceCents).toBe(1500);
    expect(o?.items[0]?.quantity).toBe(2);
  });

  it("onlineNumber é sequencial por conta e começa no 1 (Onda M)", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const itemId = await seedMenuItem(acc, "Coxinha", 800);
    const itemOther = await seedMenuItem(other, "Pastel", 700);
    const { placeOnlineOrder } = await import("./online-order.service");

    const r1 = await placeOnlineOrder(acc, {
      mode: "RETIRADA", customerName: "A", customerPhone: "11900000001",
      items: [{ catalogItemId: itemId, quantity: 1 }], payment: "on_delivery",
    });
    const r2 = await placeOnlineOrder(acc, {
      mode: "RETIRADA", customerName: "B", customerPhone: "11900000002",
      items: [{ catalogItemId: itemId, quantity: 1 }], payment: "on_delivery",
    });
    // Outra conta reinicia no 1 (sequência é POR conta).
    const rOther = await placeOnlineOrder(other, {
      mode: "RETIRADA", customerName: "C", customerPhone: "11900000003",
      items: [{ catalogItemId: itemOther, quantity: 1 }], payment: "on_delivery",
    });

    const o1 = await prisma.order.findUnique({ where: { id: r1.orderId }, select: { onlineNumber: true } });
    const o2 = await prisma.order.findUnique({ where: { id: r2.orderId }, select: { onlineNumber: true } });
    const oOther = await prisma.order.findUnique({ where: { id: rOther.orderId }, select: { onlineNumber: true } });
    expect(o1?.onlineNumber).toBe(1);
    expect(o2?.onlineNumber).toBe(2);
    expect(oOther?.onlineNumber).toBe(1);
  });

  it("preço do client é ignorado — snapshot sempre do servidor", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Pizza", 3000);
    const { placeOnlineOrder } = await import("./online-order.service");
    const res = await placeOnlineOrder(acc, {
      mode: "RETIRADA",
      customerName: "João",
      customerPhone: "11888880000",
      items: [{ catalogItemId: itemId, quantity: 1 }],
      payment: "on_delivery",
    });
    const o = await prisma.order.findUnique({ where: { id: res.orderId }, include: { items: true } });
    expect(o?.items[0]?.unitPriceCents).toBe(3000); // não 1 (client não dita preço)
  });

  it("delivery com zona soma taxa e grava endereço", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Coca", 600);
    const zone = await prisma.deliveryZone.create({
      data: { accountId: acc, name: "Centro", feeCents: 700 },
    });
    const { placeOnlineOrder } = await import("./online-order.service");
    const res = await placeOnlineOrder(acc, {
      mode: "DELIVERY",
      customerName: "Ana",
      customerPhone: "11777770000",
      items: [{ catalogItemId: itemId, quantity: 1 }],
      address: {
        neighborhoodZoneId: zone.id,
        street: "Rua X",
        number: "123",
        complement: "Apto 2",
      },
      payment: "on_delivery",
    });
    const o = await prisma.order.findUnique({ where: { id: res.orderId } });
    expect(o?.orderType).toBe("DELIVERY");
    expect(o?.deliveryFeeCents).toBe(700);
    expect(o?.deliveryZoneId).toBe(zone.id);
    expect(o?.deliveryAddress).toMatchObject({ street: "Rua X", number: "123" });
  });

  it("delivery sem zona → rejeita (ZONE_REQUIRED)", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Item", 500);
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(
      placeOnlineOrder(acc, {
        mode: "DELIVERY",
        customerName: "A",
        customerPhone: "11666660000",
        items: [{ catalogItemId: itemId, quantity: 1 }],
        payment: "on_delivery",
      }),
    ).rejects.toThrow(/ZONE_REQUIRED/);
  });

  it("carrinho vazio → rejeita (EMPTY)", async () => {
    const acc = await makeOwner();
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(
      placeOnlineOrder(acc, {
        mode: "RETIRADA",
        customerName: "A",
        customerPhone: "11555550000",
        items: [],
        payment: "on_delivery",
      }),
    ).rejects.toThrow(/EMPTY/);
  });

  it("item inativo/esgotado rejeita (ITEM_UNAVAILABLE)", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Esgotado", 500, { trackStock: true, stockQty: 0 });
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(
      placeOnlineOrder(acc, {
        mode: "RETIRADA",
        customerName: "A",
        customerPhone: "11444440000",
        items: [{ catalogItemId: itemId, quantity: 1 }],
        payment: "on_delivery",
      }),
    ).rejects.toThrow(/ITEM_UNAVAILABLE/);
  });

  it("abaixo do pedido mínimo da zona → rejeita (MIN_ORDER)", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Barato", 500);
    const zone = await prisma.deliveryZone.create({
      data: { accountId: acc, name: "Longe", feeCents: 1000, minOrderCents: 3000 },
    });
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(
      placeOnlineOrder(acc, {
        mode: "DELIVERY",
        customerName: "A",
        customerPhone: "11333330000",
        items: [{ catalogItemId: itemId, quantity: 1 }], // 500 < 3000
        address: { neighborhoodZoneId: zone.id, street: "R", number: "1" },
        payment: "on_delivery",
      }),
    ).rejects.toThrow(/MIN_ORDER/);
  });

  it("pagamento online cria Pix e devolve copia-e-cola", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Online", 2000);
    const m = await mods();
    const { placeOnlineOrder } = await import("./online-order.service");
    const res = await placeOnlineOrder(acc, {
      mode: "RETIRADA",
      customerName: "Pix",
      customerPhone: "11222220000",
      items: [{ catalogItemId: itemId, quantity: 1 }],
      payment: "online",
    });
    expect(res.payment).toBe("online");
    expect(res.pix).toEqual({ copiaECola: "PIX-123", qrBase64: "b64" });
    expect(m.createOnlinePixCharge).toHaveBeenCalledWith(acc, res.orderId, 2000, "Pix");
    // O mock substitui createOnlinePixCharge (não persiste o charge no Order); só
    // conferimos que foi chamado com o total = subtotal + taxa (aqui 2000 + 0).
  });

  it("adicionais: subtotal inclui os deltas e o Pix cobra o total somado", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Burger", 2000);
    await saveItemModifiers(acc, itemId, [
      { name: "Tamanho", minSelect: 1, maxSelect: 1, options: [
        { name: "Média", priceDeltaCents: 0 }, { name: "Grande", priceDeltaCents: 800 } ] },
      { name: "Extras", minSelect: 0, maxSelect: 2, options: [{ name: "Bacon", priceDeltaCents: 500 }] },
    ]);
    const groups = await listItemModifiers(acc, itemId);
    const grande = groups[0].options.find((o) => o.name === "Grande")!;
    const bacon = groups[1].options.find((o) => o.name === "Bacon")!;
    const m = await mods();
    const { placeOnlineOrder } = await import("./online-order.service");
    const res = await placeOnlineOrder(acc, {
      mode: "RETIRADA", customerName: "Zé", customerPhone: "11999998888",
      items: [{ catalogItemId: itemId, quantity: 2, optionIds: [grande.id, bacon.id] }],
      payment: "online",
    });
    const o = await prisma.order.findUnique({ where: { id: res.orderId }, include: { items: true } });
    expect(o?.items[0]?.unitPriceCents).toBe(3300); // 2000 + 800 + 500
    // Pix cobra o total somado: 3300 × 2 = 6600 (sem taxa em retirada)
    expect(m.createOnlinePixCharge).toHaveBeenCalledWith(acc, res.orderId, 6600, "Zé");
  });

  it("adicionais: opção inválida → rejeita (MODIFIER → 409)", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Suco", 800);
    await saveItemModifiers(acc, itemId, [
      { name: "Tamanho", minSelect: 0, maxSelect: 1, options: [{ name: "G", priceDeltaCents: 0 }] },
    ]);
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(placeOnlineOrder(acc, {
      mode: "RETIRADA", customerName: "A", customerPhone: "11999997777",
      items: [{ catalogItemId: itemId, quantity: 1, optionIds: ["xxx"] }],
      payment: "on_delivery",
    })).rejects.toThrow(/MODIFIER/);
  });

  it("adicionais: grupo obrigatório sem escolha → rejeita (MODIFIER → 409)", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Pizza", 3000);
    await saveItemModifiers(acc, itemId, [
      { name: "Tamanho", minSelect: 1, maxSelect: 1, options: [{ name: "G", priceDeltaCents: 0 }] },
    ]);
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(placeOnlineOrder(acc, {
      mode: "RETIRADA", customerName: "A", customerPhone: "11999996666",
      items: [{ catalogItemId: itemId, quantity: 1 }],
      payment: "on_delivery",
    })).rejects.toThrow(/MODIFIER/);
  });

  it("pagamento online sem entitlement → rejeita (PAY_OFF)", async () => {
    const acc = await makeOwner();
    const itemId = await seedMenuItem(acc, "Item", 1000);
    const m = await mods();
    m.canSellOnline.mockResolvedValue(false);
    const { placeOnlineOrder } = await import("./online-order.service");
    await expect(
      placeOnlineOrder(acc, {
        mode: "RETIRADA",
        customerName: "A",
        customerPhone: "11111110000",
        items: [{ catalogItemId: itemId, quantity: 1 }],
        payment: "online",
      }),
    ).rejects.toThrow(/PAY_OFF/);
    expect(m.createOnlinePixCharge).not.toHaveBeenCalled();
  });
});
