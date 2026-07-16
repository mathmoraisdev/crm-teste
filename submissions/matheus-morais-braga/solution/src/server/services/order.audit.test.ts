import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder, voidOrder, setOrderAdjustments } from "./order.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `oaudit_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}

/** Abre uma comanda, adiciona um item e fecha — devolve o DTO FECHADO. */
async function makeClosedOrder(owner: string) {
  const item = await createCatalogItem(owner, { name: "Corte", priceCents: 4000 });
  const order = await openOrder(owner, { openedById: owner, customerName: "João" });
  await addItem(owner, order.id, { catalogItemId: item.id, quantity: 1 });
  return closeOrder(owner, order.id, { payment: "DINHEIRO" });
}

describe("order audit", () => {
  it("estorno grava AuditLog ORDER_VOID com autor e motivo", async () => {
    const owner = await makeOwner();
    const order = await makeClosedOrder(owner);
    await voidOrder(owner, order.id, "cliente desistiu", owner);

    const log = await prisma.auditLog.findFirst({
      where: { accountId: owner, action: "ORDER_VOID", entityId: order.id },
    });
    expect(log).toBeTruthy();
    expect(log?.entityType).toBe("Order");
    expect(log?.actorName).toBe("Dono");
    expect(log?.summary).toContain("cliente desistiu");
  });

  it("ajuste de desconto grava AuditLog ORDER_DISCOUNT com diff", async () => {
    const owner = await makeOwner();
    const item = await createCatalogItem(owner, { name: "Corte", priceCents: 4000 });
    const order = await openOrder(owner, { openedById: owner, customerName: "João" });
    await addItem(owner, order.id, { catalogItemId: item.id, quantity: 1 });
    await setOrderAdjustments(owner, order.id, { discountCents: 1000 }, owner);

    const log = await prisma.auditLog.findFirst({
      where: { accountId: owner, action: "ORDER_DISCOUNT", entityId: order.id },
    });
    expect(log).toBeTruthy();
    expect((log?.diff as any).discountCents.from).toBeNull();
    expect((log?.diff as any).discountCents.to).toBe(1000);
    expect(log?.summary).toContain("desconto");
  });

  it("ajuste sem mudar desconto/acréscimo (só gorjeta) NÃO gera ORDER_DISCOUNT", async () => {
    const owner = await makeOwner();
    const item = await createCatalogItem(owner, { name: "Corte", priceCents: 4000 });
    const order = await openOrder(owner, { openedById: owner, customerName: "João" });
    await addItem(owner, order.id, { catalogItemId: item.id, quantity: 1 });
    await setOrderAdjustments(owner, order.id, { tipCents: 500 }, owner);

    const log = await prisma.auditLog.findFirst({
      where: { accountId: owner, action: "ORDER_DISCOUNT", entityId: order.id },
    });
    expect(log).toBeNull();
  });
});
