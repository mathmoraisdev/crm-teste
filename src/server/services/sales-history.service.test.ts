import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder, voidOrder } from "./order.service";
import { listSalesHistory, listSalesOperators } from "./sales-history.service";

describe("sales-history.service", () => {
  it("lista comandas fechadas com operador, data e cliente; filtra por operador e nome", async () => {
    const acc = (await prisma.user.create({ data: { email: `h_dono_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" } })).id;
    const op = await prisma.user.create({ data: { email: `op_${Math.random()}@t.test`, name: "Ana Operadora", passwordHash: "x", ownerId: acc, role: "OPERADOR" } });
    const item = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });

    const o1 = await openOrder(acc, { openedById: acc, customerName: "João Silva" });
    await addItem(acc, o1.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o1.id, { payment: "DINHEIRO" });

    const o2 = await openOrder(acc, { openedById: op.id, customerName: "Maria Souza" });
    await addItem(acc, o2.id, { catalogItemId: item.id, quantity: 2 });
    await closeOrder(acc, o2.id, { payment: "PIX" });

    await openOrder(acc, { openedById: acc, customerName: "Aberta" }); // ABERTA — não entra

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);

    const all = await listSalesHistory(acc, { from, to });
    expect(all.total).toBe(2);
    const j = all.items.find((r) => r.customerName === "João Silva")!;
    expect(j.operatorName).toBe("Dono");
    expect(j.totalCents).toBe(4000);
    expect(j.payment).toBe("DINHEIRO");
    expect(j.closedAt).toBeTruthy();

    // filtro por operador
    const byOp = await listSalesHistory(acc, { from, to, operatorId: op.id });
    expect(byOp.items.map((r) => r.customerName)).toEqual(["Maria Souza"]);

    // busca por nome do cliente
    const byName = await listSalesHistory(acc, { from, to, query: "joão" });
    expect(byName.items.map((r) => r.customerName)).toEqual(["João Silva"]);

    // operadores distintos p/ o filtro
    const ops = await listSalesOperators(acc);
    expect(ops.map((o) => o.name).sort()).toEqual(["Ana Operadora", "Dono"]);
  });

  it("estornada some do extrato por padrão; includeCanceled a traz marcada", async () => {
    const acc = (await prisma.user.create({ data: { email: `h_est_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" } })).id;
    const item = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "Cancelado" });
    await addItem(acc, o.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO" });
    await voidOrder(acc, o.id, "valor errado", acc);

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);

    // padrão: não aparece
    const def = await listSalesHistory(acc, { from, to });
    expect(def.total).toBe(0);
    expect(def.items).toHaveLength(0);

    // includeCanceled: aparece marcada com o motivo
    const withCanceled = await listSalesHistory(acc, { from, to, includeCanceled: true });
    expect(withCanceled.total).toBe(1);
    expect(withCanceled.items[0].status).toBe("CANCELADA");
    expect(withCanceled.items[0].canceledReason).toBe("valor errado");
  });
});
