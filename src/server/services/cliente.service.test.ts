import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { openOrder, addItem, closeOrder } from "./order.service";
import { listClientes, getClienteHistory } from "./cliente.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cli_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

async function makeLead(userId: string, name: string, phone: string) {
  const l = await prisma.lead.create({ data: { userId, name, phone } });
  return l.id;
}

describe("cliente.service — agregação de pós-venda", () => {
  it("soma total gasto e conta comandas FECHADA do lead", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "Ana Cliente", "+5511990001111");

    // 2 comandas fechadas + 1 aberta (não deve entrar no total)
    const o1 = await openOrder(acc, { openedById: acc, leadId });
    await addItem(acc, o1.id, { name: "Sessão 1", unitPriceCents: 12000, quantity: 1 });
    await closeOrder(acc, o1.id, { payment: "PIX" });

    const o2 = await openOrder(acc, { openedById: acc, leadId });
    await addItem(acc, o2.id, { name: "Sessão 2", unitPriceCents: 8000, quantity: 2 }); // 16000
    await closeOrder(acc, o2.id, { payment: "DINHEIRO" });

    const aberta = await openOrder(acc, { openedById: acc, leadId });
    await addItem(acc, aberta.id, { name: "Em aberto", unitPriceCents: 5000, quantity: 1 });

    const { items } = await listClientes(acc);
    const hit = items.find((c) => c.id === leadId)!;
    expect(hit).toBeTruthy();
    expect(hit.totalSpentCents).toBe(12000 + 16000); // só as FECHADA
    expect(hit.orderCount).toBe(2);
    expect(hit.lastOrderAt).toBeTruthy();
  });

  it("não vaza comandas de outro dono", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const leadId = await makeLead(acc, "Beto", "+5511990002222");

    const o = await openOrder(acc, { openedById: acc, leadId });
    await addItem(acc, o.id, { name: "X", unitPriceCents: 9999, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "PIX" });

    // outro dono não enxerga o cliente nem o histórico
    const { items } = await listClientes(other);
    expect(items.find((c) => c.id === leadId)).toBeUndefined();
    expect(await getClienteHistory(other, leadId)).toBeNull();

    // dono legítimo enxerga com o total certo
    const hist = await getClienteHistory(acc, leadId);
    expect(hist).toBeTruthy();
    expect(hist!.totalSpentCents).toBe(9999);
    expect(hist!.orderCount).toBe(1);
    expect(hist!.orders).toHaveLength(1);
  });

  it("busca por dígitos do telefone casa mesmo com máscara", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "Carla", "+5511987654321");
    const { items } = await listClientes(acc, { query: "(11) 98765-4321" });
    expect(items.find((c) => c.id === leadId)).toBeTruthy();
  });

  it("ordena por última compra no banco (comprador recente vem antes, mesmo com updatedAt antigo)", async () => {
    const acc = await makeOwner();
    // "antigo" é criado por último (updatedAt mais novo) mas NÃO compra;
    // "recente" é criado primeiro mas fecha uma comanda → deve vir na frente.
    const recenteId = await makeLead(acc, "Recente", "+5511900010001");
    const o = await openOrder(acc, { openedById: acc, leadId: recenteId });
    await addItem(acc, o.id, { name: "Serviço", unitPriceCents: 5000, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "PIX" });
    const semCompraId = await makeLead(acc, "SemCompra", "+5511900010002"); // updatedAt mais novo

    const { items } = await listClientes(acc);
    const idx = (id: string) => items.findIndex((c) => c.id === id);
    expect(idx(recenteId)).toBeGreaterThanOrEqual(0);
    expect(idx(recenteId)).toBeLessThan(idx(semCompraId)); // comprador antes de quem nunca comprou
  });
});
