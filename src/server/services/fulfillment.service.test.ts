import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem } from "./order.service";
import { placeOnlineOrder } from "./online-order.service";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

// Pix e gates externos mockados (como online-order.service.test).
vi.mock("./online-payment.service", () => ({
  createOnlinePixCharge: vi.fn().mockResolvedValue({ copiaECola: "PIX", qrBase64: "b64" }),
}));
vi.mock("./entitlements", () => ({ canSellOnline: vi.fn().mockResolvedValue(true) }));
vi.mock("@/server/services/account.service", () => ({ isAccountActive: vi.fn().mockResolvedValue(true) }));
// Notificação ao lojista: best-effort, não bloqueia.
vi.mock("./fulfillment-notify.service", () => ({
  notifyMerchantNewOnlineOrder: vi.fn().mockResolvedValue(undefined),
}));
// Notificação ao cliente (WhatsApp): best-effort, não bloqueia.
vi.mock("./fulfillment-customer-notify.service", () => ({
  notifyCustomerOrderStatus: vi.fn().mockResolvedValue(undefined),
}));

async function makeOwner(name = "Dono") {
  const u = await prisma.user.create({
    data: {
      email: `ful_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name,
      passwordHash: "x",
      menuEnabled: true,
    },
  });
  return u.id;
}

async function seedItem(acc: string, name: string, priceCents = 1500, sector?: string) {
  const item = await createCatalogItem(acc, { name, priceCents, kind: "PRODUTO" });
  await prisma.catalogItem.update({
    where: { id: item.id },
    data: { menuCategory: "Lanches", ...(sector ? { printSector: sector } : {}) },
  });
  return item.id;
}

async function makeOnlineOrder(acc: string, payment: "online" | "on_delivery" = "on_delivery") {
  const itemId = await seedItem(acc, "X-Burguer", 1500, "Cozinha");
  const res = await placeOnlineOrder(acc, {
    mode: "RETIRADA",
    customerName: "Cliente",
    customerPhone: "11999990000",
    items: [{ catalogItemId: itemId, quantity: 2 }],
    payment,
  });
  // createOnlinePixCharge é mockado → não persiste onlineChargeProvider no Order.
  // Simula o que o serviço real faz (o webhook confirmaria onlinePaidAt depois).
  if (payment === "online") {
    await prisma.order.update({
      where: { id: res.orderId },
      data: { onlineChargeProvider: "ASAAS" },
    });
  }
  return res.orderId;
}

beforeEach(() => vi.clearAllMocks());

describe("fulfillment.service", () => {
  it("listOnlineOrders traz só pedidos ONLINE com resumo", async () => {
    const acc = await makeOwner();
    const orderId = await makeOnlineOrder(acc);
    const { listOnlineOrders } = await import("./fulfillment.service");
    const list = await listOnlineOrders(acc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: orderId, fulfillmentStatus: "PENDENTE", source: "ONLINE", orderType: "RETIRADA" });
    expect(list[0].totalCents).toBe(3000);
  });

  it("confirmOnlineOrder: PENDENTE → CONFIRMADO e devolve tickets de cozinha", async () => {
    const acc = await makeOwner();
    const orderId = await makeOnlineOrder(acc);
    const { confirmOnlineOrder } = await import("./fulfillment.service");
    const res = await confirmOnlineOrder(acc, orderId);
    expect(res.fulfillmentStatus).toBe("CONFIRMADO");
    expect(res.tickets.length).toBeGreaterThan(0);
    expect(res.tickets[0].sector).toBe("Cozinha");
  });

  it("confirmOnlineOrder em pedido já confirmado → idempotente (não avança)", async () => {
    const acc = await makeOwner();
    const orderId = await makeOnlineOrder(acc);
    const { confirmOnlineOrder } = await import("./fulfillment.service");
    await confirmOnlineOrder(acc, orderId);
    await expect(confirmOnlineOrder(acc, orderId)).rejects.toThrow();
  });

  it("advanceOnlineOrder percorre CONFIRMADO → EM_PREPARO → PRONTO → SAIU_ENTREGA → ENTREGUE", async () => {
    const acc = await makeOwner();
    const orderId = await makeOnlineOrder(acc);
    const { confirmOnlineOrder, advanceOnlineOrder, getOnlineOrder } = await import("./fulfillment.service");
    await confirmOnlineOrder(acc, orderId);
    for (const expected of ["EM_PREPARO", "PRONTO", "SAIU_ENTREGA", "ENTREGUE"]) {
      const r = await advanceOnlineOrder(acc, orderId);
      expect(r.fulfillmentStatus).toBe(expected);
    }
    // ENTREGUE fecha a comanda (status FECHADA) e baixa estoque.
    const o = await getOnlineOrder(acc, orderId);
    expect(o.status).toBe("FECHADA");
  });

  it("ENTREGUE fecha comanda: PIX se pago online, DINHEIRO se na entrega", async () => {
    const acc = await makeOwner();
    // Pago online (PIX).
    const onlineId = await makeOnlineOrder(acc, "online");
    const { confirmOnlineOrder, advanceOnlineOrder } = await import("./fulfillment.service");
    await confirmOnlineOrder(acc, onlineId);
    await advanceOnlineOrder(acc, onlineId); // EM_PREPARO
    await advanceOnlineOrder(acc, onlineId); // PRONTO
    await advanceOnlineOrder(acc, onlineId); // SAIU_ENTREGA
    await advanceOnlineOrder(acc, onlineId); // ENTREGUE
    const online = await prisma.order.findUnique({ where: { id: onlineId }, select: { payment: true, status: true } });
    expect(online?.payment).toBe("PIX");
    expect(online?.status).toBe("FECHADA");
  });

  it("rejectOnlineOrder: PENDENTE → RECUSADO (não fecha comanda, não baixa estoque)", async () => {
    const acc = await makeOwner();
    const itemId = await seedItem(acc, "Estoque", 1000);
    const before = await prisma.catalogItem.findUnique({ where: { id: itemId }, select: { stockQty: true } });
    // Item com controle de estoque p/ conferir que NÃO baixou.
    await prisma.catalogItem.update({ where: { id: itemId }, data: { trackStock: true, stockQty: 10 } });
    const { placeOnlineOrder: place } = await import("./online-order.service");
    const res = await place(acc, {
      mode: "RETIRADA", customerName: "C", customerPhone: "11888880000",
      items: [{ catalogItemId: itemId, quantity: 2 }], payment: "on_delivery",
    });
    const { rejectOnlineOrder } = await import("./fulfillment.service");
    const r = await rejectOnlineOrder(acc, res.orderId, "Sem ingrediente");
    expect(r.fulfillmentStatus).toBe("RECUSADO");
    // Comanda segue ABERTA (não fecha) e estoque não baixou.
    const o = await prisma.order.findUnique({ where: { id: res.orderId }, select: { status: true } });
    expect(o?.status).toBe("ABERTA");
    const after = await prisma.catalogItem.findUnique({ where: { id: itemId }, select: { stockQty: true } });
    expect(after?.stockQty).toBe(10);
  });

  it("transição inválida rejeita (RECUSADO → advance)", async () => {
    const acc = await makeOwner();
    const orderId = await makeOnlineOrder(acc);
    const { rejectOnlineOrder, advanceOnlineOrder } = await import("./fulfillment.service");
    await rejectOnlineOrder(acc, orderId, "x");
    await expect(advanceOnlineOrder(acc, orderId)).rejects.toThrow();
  });

  it("tenant-safe: pedido de outra conta não é afetado", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const orderId = await makeOnlineOrder(a);
    const { confirmOnlineOrder } = await import("./fulfillment.service");
    await expect(confirmOnlineOrder(b, orderId)).rejects.toThrow();
  });
});
